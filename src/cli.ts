#!/usr/bin/env node

import { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { existsSync } from "fs";

import { fetchCommitsByUser } from "./github/commits.js";
import { fetchPRsByUser } from "./github/prs.js";
import { fetchIssueActivityByUser } from "./github/issues.js";
import { generateStandupNote } from "./ai/summarize.js";
import { postStandupToSlack } from "./slack/post.js";
import { startScheduler } from "./scheduler/cron.js";
import { runSetupWizard, loadConfig, getEnvPath, showCurrentConfig, showUpdateHelp, updateConfig } from "./setup.js";
import { runInteractiveAgent } from "./agent/loop.js";

// ── CLI Commands ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  // Setup command
  if (command === "setup" || command === "configure") {
    await runSetupWizard();
    return;
  }

  // Update command
  if (command === "update") {
    const field = args[1];
    const value = args.slice(2).join(" ");
    if (!field) {
      showCurrentConfig();
      showUpdateHelp();
      return;
    }
    updateConfig(field, value);
    return;
  }

  // Check if setup has been run
  const envPath = getEnvPath();
  if (!existsSync(envPath)) {
    console.error(`
❌ Configuration not found. Please run setup first:

    standup-cli setup

`);
    process.exit(1);
  }

  // Load env from ~/.standup-cli/.env
  dotenv.config({ path: envPath });

  const config = loadConfig();

  if (command === "agent" || command === "chat" || command === "-a") {
    await runAgentJob(config);
  } else if (command === "run" || command === "--run-now" || command === "-r") {
    await runStandupJob(config);
  } else if (command === "schedule" || command === "--schedule" || command === "-s") {
    startScheduler(config.schedule, config.timezone, async () => {
      await runStandupJob(config);
    });
  } else if (command === "status") {
    showStatus(config);
  } else {
    showHelp();
  }
}

// ── Core Standup Job ─────────────────────────────────────────────────────────

async function runStandupJob(config: any): Promise<void> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const lookbackMs = config.lookback_hours * 60 * 60 * 1000;
  const since = new Date(Date.now() - lookbackMs);

  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: config.timezone,
  });

  console.log(`\n📋 Generating standups for: ${config.team_members.join(", ")}`);
  console.log(`📅 Looking back ${config.lookback_hours} hours (since ${since.toISOString()})\n`);

  const standupNotes = [];

  for (const username of config.team_members) {
    console.log(`  🔍 Fetching activity for ${username}...`);

    const [commits, prs, issueActivity] = await Promise.all([
      fetchCommitsByUser(octokit, config.github_owner, config.github_repo, username, since),
      fetchPRsByUser(octokit, config.github_owner, config.github_repo, username, since),
      fetchIssueActivityByUser(octokit, config.github_owner, config.github_repo, username, since),
    ]);

    console.log(
      `     commits: ${commits.length}, PRs: ${prs.length}, issue activity: ${issueActivity.length}`
    );

    const note = await generateStandupNote(anthropic, {
      username,
      commits,
      prs,
      issueActivity,
      lookbackHours: config.lookback_hours,
    });

    standupNotes.push(note);
    console.log(`  ✅ Standup generated for ${username}`);
  }

  console.log(`\n📤 Posting to Slack...`);
  await postStandupToSlack(
    process.env.SLACK_USER_TOKEN!,
    process.env.SLACK_CHANNEL_ID!,
    standupNotes,
    "🌅 Daily Standup",
    dateLabel
  );

  console.log(`\n✅ Done! Standup posted for ${standupNotes.length} team members.\n`);
}

// ── Agent Job ────────────────────────────────────────────────────────────────

async function runAgentJob(config: any): Promise<void> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  await runInteractiveAgent(anthropic, octokit, process.env.SLACK_USER_TOKEN!, process.env.SLACK_CHANNEL_ID!, config);
}

// ── CLI Helpers ──────────────────────────────────────────────────────────────

function showStatus(config: any) {
  const repos: { owner: string; repo: string }[] = config.github_repos ?? [
    { owner: config.github_owner, repo: config.github_repo },
  ];
  const repoLabel = repos.length === 1
    ? `${repos[0].owner}/${repos[0].repo}`
    : `${repos.length} repos`;

  console.log(`
╔═══════════════════════════════════════════════════╗
║   standup-cli Status                              ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║   Schedule:          ${config.schedule.padEnd(27, ' ')}║
║   Timezone:          ${config.timezone.padEnd(27, ' ')}║
║   Team members:      ${String(config.team_members.length + ' members').padEnd(24, ' ')}║
║   Repo:              ${repoLabel.padEnd(27, ' ')}║
║                                                   ║
╚═══════════════════════════════════════════════════╝
`);

  if (repos.length > 1) {
    console.log("  Repositories:");
    for (const r of repos) {
      console.log(`    - ${r.owner}/${r.repo}`);
    }
    console.log();
  }
}

function showHelp() {
  console.log(`
standup-cli — AI-powered daily standup generator

Usage:
  standup-cli setup                    Interactive setup wizard
  standup-cli run                      Generate and post standup right now (pipeline)
  standup-cli agent                    Interactive chat — ask about team activity, post standups
  standup-cli schedule                 Start daily scheduler
  standup-cli status                   Show current configuration summary
  standup-cli update [field] [value]   Update a single config field

Aliases:
  standup-cli -r          Same as 'run'
  standup-cli -a          Same as 'agent'
  standup-cli chat        Same as 'agent'
  standup-cli -s          Same as 'schedule'
  standup-cli configure   Same as 'setup'

Examples:
  standup-cli setup                            # First-time setup
  standup-cli run                              # Pipeline mode — fast, fixed steps
  standup-cli agent                            # Chat — ask about PRs, commits, post standups
  standup-cli schedule                         # Run daily at configured time
  standup-cli update team-members alice,bob    # Update team members
  standup-cli update repos org/fe,org/be       # Update repositories
  standup-cli update                           # Show current config + available fields

Configuration is stored in: ~/.standup-cli/
`);
}

// ── Entry Point ──────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
