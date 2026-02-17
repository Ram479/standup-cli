import Anthropic from "@anthropic-ai/sdk";
import type { CommitSummary } from "../github/commits.js";
import type { PRSummary } from "../github/prs.js";
import type { IssueActivitySummary } from "../github/issues.js";

export interface UserActivity {
  username: string;
  commits: CommitSummary[];
  prs: PRSummary[];
  issueActivity: IssueActivitySummary[];
  lookbackHours: number;
}

export interface StandupNote {
  username: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
  rawSummary: string;
}

export async function generateStandupNote(
  client: Anthropic,
  activity: UserActivity
): Promise<StandupNote> {
  const hasActivity =
    activity.commits.length > 0 ||
    activity.prs.length > 0 ||
    activity.issueActivity.length > 0;

  if (!hasActivity) {
    return {
      username: activity.username,
      yesterday: ["No GitHub activity recorded in the last " + activity.lookbackHours + " hours"],
      today: [],
      blockers: [],
      rawSummary: "No activity",
    };
  }

  const activityText = buildActivityText(activity);

  const prompt = `You are a technical project manager assistant. Based on the following GitHub activity for developer "${activity.username}" over the last ${activity.lookbackHours} hours, generate a concise daily standup update.

GitHub Activity:
${activityText}

Generate a standup in this EXACT JSON format:
{
  "yesterday": ["bullet point 1", "bullet point 2"],
  "today": ["inferred task 1", "inferred task 2"],
  "blockers": ["blocker 1"] 
}

Rules:
- "yesterday" = what they actually did based on the activity data (be specific, mention PR/issue numbers)
- "today" = infer what they'll likely work on next based on open PRs, assigned issues, and unresolved items
- "blockers" = only include if there are open issues with "blocked", "waiting", "pending" in title/comments, otherwise return empty array []
- Keep each bullet point under 15 words
- Use plain English, no markdown formatting inside the strings
- Return ONLY the JSON, no explanation`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Strip any markdown code fences if present
    const cleaned = responseText.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      username: activity.username,
      yesterday: parsed.yesterday ?? [],
      today: parsed.today ?? [],
      blockers: parsed.blockers ?? [],
      rawSummary: responseText,
    };
  } catch (error: any) {
    console.warn(`⚠️  AI summarization failed for ${activity.username}: ${error.message}`);
    return {
      username: activity.username,
      yesterday: activity.commits.map((c) => `${c.sha}: ${c.message}`),
      today: [],
      blockers: [],
      rawSummary: "AI summarization failed — raw commits listed",
    };
  }
}

function buildActivityText(activity: UserActivity): string {
  const lines: string[] = [];

  if (activity.commits.length > 0) {
    lines.push("COMMITS:");
    activity.commits.forEach((c) => {
      lines.push(`  - [${c.sha}] ${c.message} (${c.timestamp})`);
    });
  }

  if (activity.prs.length > 0) {
    lines.push("\nPULL REQUESTS:");
    activity.prs.forEach((pr) => {
      lines.push(`  - PR #${pr.number} ${pr.action.toUpperCase()}: "${pr.title}" (${pr.timestamp})`);
    });
  }

  if (activity.issueActivity.length > 0) {
    lines.push("\nISSUE ACTIVITY:");
    activity.issueActivity.forEach((issue) => {
      const comment = issue.comment ? ` — commented: "${issue.comment.substring(0, 100)}..."` : "";
      lines.push(
        `  - Issue #${issue.number} ${issue.action.toUpperCase()}: "${issue.title}"${comment} (${issue.timestamp})`
      );
    });
  }

  return lines.join("\n");
}
