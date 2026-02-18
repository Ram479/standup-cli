import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { fetchCommitsByUser } from "../github/commits.js";
import { fetchPRsByUser } from "../github/prs.js";
import { fetchIssueActivityByUser } from "../github/issues.js";
import { postStandupToSlack } from "../slack/post.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolContext {
  octokit: Octokit;
  since: Date;
  slackToken: string;
  slackChannelId: string;
  timezone: string;
  /** Repos the agent is allowed to query. If set, requests outside this list are rejected. */
  allowedRepos?: { owner: string; repo: string }[];
  /** Team members the agent is allowed to look up. If set, requests outside this list are rejected. */
  allowedMembers?: string[];
}

interface StandupEntry {
  username: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
}

// ── Validation Helpers ───────────────────────────────────────────────────────

function validateRepo(
  owner: string,
  repo: string,
  ctx: ToolContext
): string | null {
  if (!ctx.allowedRepos) return null;
  const allowed = ctx.allowedRepos.some(
    (r) =>
      r.owner.toLowerCase() === owner.toLowerCase() &&
      r.repo.toLowerCase() === repo.toLowerCase()
  );
  if (!allowed) {
    const list = ctx.allowedRepos
      .map((r) => `${r.owner}/${r.repo}`)
      .join(", ");
    return `Access denied: repository "${owner}/${repo}" is not in the configured list. Allowed repos: ${list}`;
  }
  return null;
}

function validateMember(username: string, ctx: ToolContext): string | null {
  if (!ctx.allowedMembers) return null;
  const allowed = ctx.allowedMembers.some(
    (m) => m.toLowerCase() === username.toLowerCase()
  );
  if (!allowed) {
    return `Access denied: "${username}" is not a configured team member. Allowed members: ${ctx.allowedMembers.join(", ")}`;
  }
  return null;
}

function formatGitHubError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const msg = error.message;
  if (msg.includes("Not Found") || msg.includes("404")) {
    return "Repository or user not found. The repo may be private or the name may be incorrect.";
  }
  if (msg.includes("Bad credentials") || msg.includes("401")) {
    return "GitHub authentication failed. The token may be invalid or expired.";
  }
  if (msg.includes("rate limit") || msg.includes("403")) {
    return "GitHub API rate limit exceeded. Please wait a few minutes and try again.";
  }
  return msg;
}

// ── Tool Definitions ─────────────────────────────────────────────────────────

export const agentTools: Anthropic.Tool[] = [
  {
    name: "fetch_commits",
    description:
      "Fetch recent commits by a specific user in a GitHub repository. Returns an array of commits with sha, message, url, and timestamp.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: {
          type: "string",
          description: "GitHub repository owner (user or org)",
        },
        repo: {
          type: "string",
          description: "GitHub repository name",
        },
        username: {
          type: "string",
          description: "GitHub username to fetch commits for",
        },
      },
      required: ["owner", "repo", "username"],
    },
  },
  {
    name: "fetch_pull_requests",
    description:
      "Fetch recent pull request activity by a specific user in a GitHub repository. Returns PRs authored, merged, and reviewed by the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: {
          type: "string",
          description: "GitHub repository owner (user or org)",
        },
        repo: {
          type: "string",
          description: "GitHub repository name",
        },
        username: {
          type: "string",
          description: "GitHub username to fetch PR activity for",
        },
      },
      required: ["owner", "repo", "username"],
    },
  },
  {
    name: "fetch_issues",
    description:
      "Fetch recent issue activity by a specific user in a GitHub repository. Returns issues opened, closed, commented on, and assigned to the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: {
          type: "string",
          description: "GitHub repository owner (user or org)",
        },
        repo: {
          type: "string",
          description: "GitHub repository name",
        },
        username: {
          type: "string",
          description: "GitHub username to fetch issue activity for",
        },
      },
      required: ["owner", "repo", "username"],
    },
  },
  {
    name: "post_standup_to_slack",
    description:
      "Post the final standup notes to Slack. Call this once after gathering and analyzing all team members' activity. Each entry should have yesterday (what they did), today (what they'll do next), and blockers.",
    input_schema: {
      type: "object" as const,
      properties: {
        standup_notes: {
          type: "array",
          description: "Array of standup entries, one per team member",
          items: {
            type: "object",
            properties: {
              username: {
                type: "string",
                description: "GitHub username of the team member",
              },
              yesterday: {
                type: "array",
                items: { type: "string" },
                description: "List of things they did (based on activity data)",
              },
              today: {
                type: "array",
                items: { type: "string" },
                description: "List of inferred upcoming tasks",
              },
              blockers: {
                type: "array",
                items: { type: "string" },
                description: "List of blockers (empty array if none)",
              },
            },
            required: ["username", "yesterday", "today", "blockers"],
          },
        },
      },
      required: ["standup_notes"],
    },
  },
];

// ── Tool Executor ────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  switch (name) {
    case "fetch_commits": {
      const { owner, repo, username } = input as {
        owner: string;
        repo: string;
        username: string;
      };

      const repoErr = validateRepo(owner, repo, ctx);
      if (repoErr) return JSON.stringify({ error: repoErr });

      const memberErr = validateMember(username, ctx);
      if (memberErr) return JSON.stringify({ error: memberErr });

      try {
        const commits = await fetchCommitsByUser(ctx.octokit, owner, repo, username, ctx.since);
        return JSON.stringify(commits, null, 2);
      } catch (error: unknown) {
        return JSON.stringify({ error: formatGitHubError(error) });
      }
    }

    case "fetch_pull_requests": {
      const { owner, repo, username } = input as {
        owner: string;
        repo: string;
        username: string;
      };

      const repoErr = validateRepo(owner, repo, ctx);
      if (repoErr) return JSON.stringify({ error: repoErr });

      const memberErr = validateMember(username, ctx);
      if (memberErr) return JSON.stringify({ error: memberErr });

      try {
        const prs = await fetchPRsByUser(ctx.octokit, owner, repo, username, ctx.since);
        return JSON.stringify(prs, null, 2);
      } catch (error: unknown) {
        return JSON.stringify({ error: formatGitHubError(error) });
      }
    }

    case "fetch_issues": {
      const { owner, repo, username } = input as {
        owner: string;
        repo: string;
        username: string;
      };

      const repoErr = validateRepo(owner, repo, ctx);
      if (repoErr) return JSON.stringify({ error: repoErr });

      const memberErr = validateMember(username, ctx);
      if (memberErr) return JSON.stringify({ error: memberErr });

      try {
        const issues = await fetchIssueActivityByUser(
          ctx.octokit,
          owner,
          repo,
          username,
          ctx.since
        );
        return JSON.stringify(issues, null, 2);
      } catch (error: unknown) {
        return JSON.stringify({ error: formatGitHubError(error) });
      }
    }

    case "post_standup_to_slack": {
      const { standup_notes } = input as { standup_notes: StandupEntry[] };

      if (!standup_notes || standup_notes.length === 0) {
        return JSON.stringify({ error: "No standup notes provided. Include at least one team member." });
      }

      // Validate all usernames in the standup are allowed members
      if (ctx.allowedMembers) {
        const invalidUsers = standup_notes
          .filter((e) => !ctx.allowedMembers!.some((m) => m.toLowerCase() === e.username.toLowerCase()))
          .map((e) => e.username);
        if (invalidUsers.length > 0) {
          return JSON.stringify({
            error: `Access denied: standup includes non-team members: ${invalidUsers.join(", ")}. Allowed: ${ctx.allowedMembers.join(", ")}`,
          });
        }
      }

      const dateLabel = new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: ctx.timezone,
      });

      const notes = standup_notes.map((entry) => ({
        username: entry.username,
        yesterday: entry.yesterday,
        today: entry.today,
        blockers: entry.blockers,
        rawSummary: "",
      }));

      try {
        await postStandupToSlack(
          ctx.slackToken,
          ctx.slackChannelId,
          notes,
          "🌅 Daily Standup",
          dateLabel
        );
        return `Standup posted to Slack for ${notes.length} team member(s).`;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("invalid_auth") || msg.includes("not_authed")) {
          return JSON.stringify({ error: "Slack authentication failed. Check your SLACK_USER_TOKEN." });
        }
        if (msg.includes("channel_not_found")) {
          return JSON.stringify({ error: "Slack channel not found. Check your SLACK_CHANNEL_ID." });
        }
        return JSON.stringify({ error: `Slack posting failed: ${msg}` });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
