import { Octokit } from "@octokit/rest";

export interface PRSummary {
  number: number;
  title: string;
  state: string;
  action: string; // "opened", "merged", "reviewed", "commented"
  url: string;
  timestamp: string;
}

export async function fetchPRsByUser(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string,
  since: Date
): Promise<PRSummary[]> {
  const results: PRSummary[] = [];

  try {
    // PRs authored by user
    const { data: authoredPRs } = await octokit.pulls.list({
      owner,
      repo,
      state: "all",
      per_page: 50,
    });

    const userPRs = authoredPRs.filter(
      (pr) =>
        pr.user?.login?.toLowerCase() === username.toLowerCase() &&
        new Date(pr.created_at) >= since
    );

    for (const pr of userPRs) {
      const action = pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "opened";
      results.push({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        action,
        url: pr.html_url,
        timestamp: pr.created_at,
      });
    }

    // PRs reviewed by user
    const { data: reviewedPRs } = await octokit.pulls.list({
      owner,
      repo,
      state: "all",
      per_page: 50,
    });

    for (const pr of reviewedPRs) {
      if (pr.user?.login?.toLowerCase() === username.toLowerCase()) continue;

      try {
        const { data: reviews } = await octokit.pulls.listReviews({
          owner,
          repo,
          pull_number: pr.number,
        });

        const userReviews = reviews.filter(
          (r) =>
            r.user?.login?.toLowerCase() === username.toLowerCase() &&
            new Date(r.submitted_at ?? "") >= since
        );

        if (userReviews.length > 0) {
          results.push({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            action: "reviewed",
            url: pr.html_url,
            timestamp: userReviews[0].submitted_at ?? "",
          });
        }
      } catch {
        // skip if reviews can't be fetched for this PR
      }
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch PRs for ${username}: ${error.message}`);
  }

  return results;
}
