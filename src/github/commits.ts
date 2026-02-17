import { Octokit } from "@octokit/rest";

export interface CommitSummary {
  sha: string;
  message: string;
  url: string;
  timestamp: string;
}

export async function fetchCommitsByUser(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string,
  since: Date
): Promise<CommitSummary[]> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      author: username,
      since: since.toISOString(),
      per_page: 50,
    });

    return data.map((commit) => ({
      sha: commit.sha.substring(0, 7),
      message: commit.commit.message.split("\n")[0], // first line only
      url: commit.html_url,
      timestamp: commit.commit.author?.date ?? "",
    }));
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch commits for ${username}: ${error.message}`);
    return [];
  }
}
