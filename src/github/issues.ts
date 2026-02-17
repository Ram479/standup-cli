import { Octokit } from "@octokit/rest";

export interface IssueActivitySummary {
  number: number;
  title: string;
  state: string;
  action: string; // "commented", "opened", "closed", "assigned"
  url: string;
  comment?: string;
  timestamp: string;
}

export async function fetchIssueActivityByUser(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string,
  since: Date
): Promise<IssueActivitySummary[]> {
  const results: IssueActivitySummary[] = [];

  try {
    // Issue comments by user
    const { data: comments } = await octokit.issues.listCommentsForRepo({
      owner,
      repo,
      since: since.toISOString(),
      per_page: 100,
    });

    const userComments = comments.filter(
      (c) => c.user?.login?.toLowerCase() === username.toLowerCase()
    );

    for (const comment of userComments) {
      // Extract issue number from the URL
      const match = comment.issue_url.match(/\/issues\/(\d+)$/);
      if (!match) continue;

      const issueNumber = parseInt(match[1]);

      try {
        const { data: issue } = await octokit.issues.get({
          owner,
          repo,
          issue_number: issueNumber,
        });

        // Skip if it's a PR (issues API returns PRs too)
        if (issue.pull_request) continue;

        results.push({
          number: issueNumber,
          title: issue.title,
          state: issue.state,
          action: "commented",
          url: issue.html_url,
          comment: comment.body?.substring(0, 200),
          timestamp: comment.created_at,
        });
      } catch {
        // skip
      }
    }

    // Issues opened or closed by user
    const { data: userIssues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "all",
      creator: username,
      since: since.toISOString(),
      per_page: 50,
    });

    for (const issue of userIssues) {
      if (issue.pull_request) continue;

      results.push({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        action: issue.state === "closed" ? "closed" : "opened",
        url: issue.html_url,
        timestamp: issue.created_at,
      });
    }

    // Issues assigned to user (in progress work)
    const { data: assignedIssues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
      assignee: username,
      per_page: 20,
    });

    for (const issue of assignedIssues) {
      if (issue.pull_request) continue;

      const alreadyAdded = results.some((r) => r.number === issue.number);
      if (!alreadyAdded) {
        results.push({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          action: "assigned",
          url: issue.html_url,
          timestamp: issue.updated_at,
        });
      }
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch issue activity for ${username}: ${error.message}`);
  }

  return results;
}
