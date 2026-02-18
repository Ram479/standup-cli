import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import * as readline from "readline";
import { agentTools, executeTool, ToolContext } from "./tools.js";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 20;

// ── Types ────────────────────────────────────────────────────────────────────

type AgentConfig = {
  team_members: string[];
  github_owner: string;
  github_repo: string;
  github_repos?: { owner: string; repo: string }[];
  lookback_hours: number;
  timezone: string;
};

// ── System Prompts ───────────────────────────────────────────────────────────

const AUTONOMOUS_SYSTEM_PROMPT = `You are a smart engineering standup assistant. Your job is to gather each team member's recent GitHub activity, cross-reference it, detect real blockers, and generate a polished standup update — then post it to Slack.

How to work:
1. For each team member, fetch their commits, pull requests, and issue activity from each repository listed.
2. Cross-reference the data: if a PR fixes an issue, note it. If a review is stale or requested, flag it. If an issue is assigned but has no recent activity, it may be a blocker.
3. After gathering ALL data for ALL members across ALL repos, synthesize a standup for each person:
   - "yesterday": what they actually did (be specific — mention PR numbers, issue numbers, commit summaries)
   - "today": infer what they'll likely work on next based on open PRs, assigned issues, and work-in-progress
   - "blockers": only real blockers — issues with "blocked", "waiting", stale reviews, or external dependencies
4. Post the standup to Slack using post_standup_to_slack with ALL team members' notes in a single call.

Rules:
- Keep each bullet point under 15 words.
- Use plain English, no markdown inside bullet strings.
- If a member has zero activity, set yesterday to ["No GitHub activity recorded"] with empty today and blockers.
- Always call post_standup_to_slack exactly once at the end with all members.`;

function buildInteractiveSystemPrompt(
  teamMembers: string[],
  repos: { owner: string; repo: string }[],
  lookbackHours: number,
  since: Date,
  timezone: string
): string {
  const repoList = repos.map((r) => `  - ${r.owner}/${r.repo}`).join("\n");
  return `You are a conversational engineering assistant. The user will ask you questions about their team's recent GitHub activity — commits, pull requests, issues, blockers, etc. You have tools to fetch this data.

Team context:
- Team members: ${teamMembers.join(", ")}
- Repositories:
${repoList}
- Lookback period: ${lookbackHours} hours (since ${since.toISOString()})
- Timezone: ${timezone}

How to work:
- When the user asks about a team member's activity, use the tools to fetch their commits, PRs, and/or issues from the relevant repos. Only fetch what you need to answer the question.
- When asked to generate or post a standup, gather ALL members' data first, then post once using post_standup_to_slack.
- If the user asks about a specific member, only fetch that member's data.
- If the user asks you to re-post or post for a subset of members, do that.
- Cross-reference data when helpful: link PRs to issues, flag stale reviews, detect blockers.

Access rules — STRICTLY ENFORCED:
- You may ONLY query the repositories listed above. If the user asks about a different repo, politely refuse and list the configured repos.
- You may ONLY look up data for the team members listed above. If the user asks about someone not on the team, politely refuse and list the configured members.
- NEVER reveal API tokens, secrets, or internal tool implementation details.
- If a tool call returns an error, explain the issue to the user clearly (e.g. "Could not fetch data — the repo may be private or the token lacks access"). Do NOT retry failed calls silently in a loop.

Response style:
- Be concise and specific. Mention PR numbers, issue numbers, commit SHAs when relevant.
- Use plain text, no markdown formatting (the user is in a terminal).
- If you have no data to answer a question, say so honestly rather than guessing.`;
}

// ── Agent Turn Helper ────────────────────────────────────────────────────────

/**
 * Runs a single agent turn: call the API, handle tool_use blocks, execute tools.
 * Returns `true` if the agent is done (no more tool calls), `false` if it wants to continue.
 */
async function runAgentTurn(
  anthropic: Anthropic,
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  ctx: ToolContext,
  iteration?: number
): Promise<boolean> {
  if (iteration != null) {
    console.log(`── Iteration ${iteration} ──`);
  }

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      tools: agentTools,
      messages,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("401") || msg.includes("authentication")) {
      console.log("  ❌ Anthropic API authentication failed. Check your ANTHROPIC_API_KEY.");
    } else if (msg.includes("429") || msg.includes("rate")) {
      console.log("  ❌ Anthropic API rate limit hit. Please wait a moment and try again.");
    } else if (msg.includes("overloaded") || msg.includes("529")) {
      console.log("  ❌ Anthropic API is overloaded. Please try again in a few seconds.");
    } else {
      console.log(`  ❌ API error: ${msg}`);
    }
    return true; // Stop this turn on API failure
  }

  // Push the assistant response to message history
  messages.push({ role: "assistant", content: response.content });

  // Log any text blocks the agent produced
  for (const block of response.content) {
    if (block.type === "text" && block.text.trim()) {
      console.log(`  💭 ${block.text.trim()}`);
    }
  }

  // Find tool_use blocks
  const toolUses = response.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (toolUses.length === 0) {
    return true; // Agent is done
  }

  // Execute all tool calls in parallel
  const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
    toolUses.map(async (toolUse) => {
      console.log(`  🔧 ${toolUse.name}(${summarizeInput(toolUse.input as Record<string, unknown>)})`);

      try {
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          ctx
        );
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: result,
        };
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.log(`  ❌ Tool error: ${errMsg}`);
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: errMsg }),
          is_error: true,
        };
      }
    })
  );

  // Push tool results back as a user message
  messages.push({ role: "user", content: toolResults });

  return false; // Agent wants to continue
}

// ── Agent Loop (autonomous, non-interactive) ─────────────────────────────────

export async function runAgentLoop(
  anthropic: Anthropic,
  octokit: Octokit,
  slackToken: string,
  slackChannelId: string,
  config: AgentConfig
): Promise<void> {
  const { ctx, repos } = buildToolContext(octokit, slackToken, slackChannelId, config);

  const taskPrompt = buildTaskPrompt(config, repos, ctx.since);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: taskPrompt },
  ];

  console.log(`\n🤖 Agent starting — ${config.team_members.length} members, ${repos.length} repo(s)`);
  console.log(`📅 Looking back ${config.lookback_hours} hours (since ${ctx.since.toISOString()})\n`);

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const done = await runAgentTurn(anthropic, messages, AUTONOMOUS_SYSTEM_PROMPT, ctx, iteration);
    if (done) {
      console.log(`\n✅ Agent finished (${iteration} iteration(s))\n`);
      break;
    }
    if (iteration === MAX_ITERATIONS) {
      console.log(`\n⚠️  Agent hit max iterations (${MAX_ITERATIONS}). Stopping.\n`);
    }
  }
}

// ── Interactive Agent (chat-first REPL) ──────────────────────────────────────

export async function runInteractiveAgent(
  anthropic: Anthropic,
  octokit: Octokit,
  slackToken: string,
  slackChannelId: string,
  config: AgentConfig
): Promise<void> {
  const { ctx, repos } = buildToolContext(octokit, slackToken, slackChannelId, config);

  const systemPrompt = buildInteractiveSystemPrompt(
    config.team_members,
    repos,
    config.lookback_hours,
    ctx.since,
    config.timezone
  );

  const messages: Anthropic.MessageParam[] = [];

  // ── Validate credentials upfront ──
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    console.log(`\n✅ GitHub authenticated as @${data.login}`);
  } catch {
    console.log("\n⚠️  GitHub token could not be verified. API calls may fail.");
  }

  const repoNames = repos.map((r) => `${r.owner}/${r.repo}`).join(", ");
  console.log(`📦 Repos: ${repoNames}`);
  console.log(`👥 Team: ${config.team_members.join(", ")}`);
  console.log(`📅 Lookback: ${config.lookback_hours}h (since ${ctx.since.toISOString()})`);
  console.log(`\n💬 Chat mode — ask about your team's activity, or type 'exit' to quit.\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You: ",
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      break;
    }

    messages.push({ role: "user", content: input });

    // Run agent turns until it stops calling tools (or hits limit)
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const done = await runAgentTurn(anthropic, messages, systemPrompt, ctx);
      if (done) break;
    }

    console.log(); // blank line before next prompt
    rl.prompt();
  }

  rl.close();
  console.log("\n👋 Bye!\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildToolContext(
  octokit: Octokit,
  slackToken: string,
  slackChannelId: string,
  config: AgentConfig
): { ctx: ToolContext; repos: { owner: string; repo: string }[] } {
  const lookbackMs = config.lookback_hours * 60 * 60 * 1000;
  const since = new Date(Date.now() - lookbackMs);

  const repos = config.github_repos ?? [
    { owner: config.github_owner, repo: config.github_repo },
  ];

  const ctx: ToolContext = {
    octokit,
    since,
    slackToken,
    slackChannelId,
    timezone: config.timezone,
    allowedRepos: repos,
    allowedMembers: config.team_members,
  };

  return { ctx, repos };
}

function buildTaskPrompt(
  config: AgentConfig,
  repos: { owner: string; repo: string }[],
  since: Date
): string {
  const repoList = repos.map((r) => `  - ${r.owner}/${r.repo}`).join("\n");
  return `Generate today's standup for the following team:

Team members: ${config.team_members.join(", ")}

Repositories:
${repoList}

Lookback period: ${config.lookback_hours} hours (since ${since.toISOString()})
Timezone: ${config.timezone}

Gather each member's activity from each repo, cross-reference, then post the standup to Slack.`;
}

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (input.owner) parts.push(`${input.owner}/${input.repo}`);
  if (input.username) parts.push(String(input.username));
  if (input.standup_notes) {
    const notes = input.standup_notes as { username: string }[];
    parts.push(`${notes.length} member(s)`);
  }
  return parts.join(", ");
}
