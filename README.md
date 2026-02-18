# standup-agent

**AI-powered daily standup agent** — pulls GitHub activity, summarizes it with Claude, and posts to Slack.

> npm package: `standup-agent` | CLI commands: `standup-agent` or `standup-cli`

---

## What it posts to Slack

```
Daily Standup — Tuesday, February 18, 2026

Ram
 Yesterday
  Completed auth module refactor (PR #42 merged)
  Reviewed and approved Priya's dashboard PR (#39)
  Commented on ticket #18 re: missing design specs

 Today
  Continue work on #15 — dashboard API integration

 Blockers
  #18 still pending design input

---

Priya
 Yesterday
  Opened PR #50 for user profile screen
  Fixed bug in payment gateway (commit a4f2b1c)
...
```

---

## Installation

```bash
npm install -g standup-agent
```

Or run directly without installing:

```bash
npx standup-agent setup
npx standup-agent run
```

After installing, both `standup-agent` and `standup-cli` work as commands.

### Requirements

- Node.js 18 or higher
- A GitHub Personal Access Token (scopes: `repo`, `read:org`)
- An Anthropic API key (you bring your own)
- A Slack User OAuth Token + Channel ID

---

## Quick Start

### 1. Run the setup wizard

```bash
standup-cli setup
```

The wizard walks you through everything interactively — GitHub token, repos, team members, Slack credentials, schedule, timezone, and Anthropic key.

### 2. Test it

```bash
standup-cli run
```

Check your Slack channel — the standup should appear within seconds.

### 3. Try interactive chat

```bash
standup-cli chat
```

Ask questions like "What did ram work on today?" or "Post standup for the backend team."

### 4. Schedule daily standups

```bash
standup-cli schedule
```

Runs every morning at the time you configured (default: 9 AM weekdays).

---

## Commands

| Command | Alias | Description |
|---|---|---|
| `standup-cli setup` | `configure` | Interactive configuration wizard |
| `standup-cli run` | `-r` | Generate and post standup right now (pipeline mode) |
| `standup-cli agent` | `-a`, `chat` | Interactive chat — ask about team activity, post standups |
| `standup-cli schedule` | `-s` | Start the daily cron scheduler |
| `standup-cli status` | | Show current configuration summary |
| `standup-cli update [field] [value]` | | Update a single config field (see below) |
| `standup-cli --help` | | Show help and all available commands |

---

## Agent / Chat Mode

```bash
standup-cli agent
# or
standup-cli chat
```

Opens an interactive REPL where you can have a conversation with the AI agent. The agent has access to tools for fetching GitHub data and posting to Slack, and decides what to call based on your request.

**Example prompts:**
- "What did ram and naveen work on in the last 24 hours?"
- "Show me open PRs that need review"
- "Generate and post standup for the whole team"
- "Summarize activity across all repos since yesterday"

### What the agent does differently from pipeline mode

- Cross-references PRs with issues (e.g., "PR #42 fixes issue #18")
- Detects stale reviews and flags them as blockers
- Identifies patterns across team members (e.g., multiple people working on the same area)
- Works across multiple repositories in a single run
- Produces more contextual "today" predictions based on work-in-progress

---

## Pipeline Mode

```bash
standup-cli run
```

A fixed, predictable pipeline: fetch commits/PRs/issues for each team member, summarize each with one Claude call, and post everything to Slack. Fast and cheap — ideal for automated daily runs.

### Cost comparison

| | Pipeline (`run`) | Agent (`agent`) |
|---|---|---|
| API calls per standup | 1 per member (Haiku) | 3-8 total (Sonnet) |
| Cost per run (8 members) | ~$0.01 | ~$0.05 |
| Monthly cost (weekdays, 6 teams) | ~$2/mo | ~$6/mo |
| Cross-referencing | None | Yes |
| Blocker detection | Keyword-based | Context-aware |

---

## Configuration

All configuration is stored in `~/.standup-cli/`.

### config.json

```json
{
  "github_token": "ghp_...",
  "github_owner": "my-org",
  "github_repo": "frontend",
  "github_repos": [
    { "owner": "my-org", "repo": "frontend" },
    { "owner": "my-org", "repo": "backend" }
  ],
  "team_members": ["alice", "bob", "charlie"],
  "slack_user_token": "xoxp-...",
  "slack_channel_id": "C0XXXXXXX",
  "anthropic_api_key": "sk-ant-...",
  "lookback_hours": 24,
  "schedule": "0 9 * * 1-5",
  "timezone": "Asia/Kolkata"
}
```

| Key | Type | Description |
|---|---|---|
| `github_token` | string | GitHub Personal Access Token |
| `github_owner` | string | Primary repo owner (org or user) |
| `github_repo` | string | Primary repo name |
| `github_repos` | array | All repos to query (used by agent mode) |
| `team_members` | string[] | GitHub usernames of team members |
| `slack_user_token` | string | Slack User OAuth Token (`xoxp-...`) |
| `slack_channel_id` | string | Slack channel ID (`C0...`) |
| `anthropic_api_key` | string | Anthropic API key (`sk-ant-...`) |
| `lookback_hours` | number | How many hours back to fetch activity (default: 24) |
| `schedule` | string | Cron expression for the scheduler |
| `timezone` | string | IANA timezone for scheduling |

### .env

The `.env` file at `~/.standup-cli/.env` mirrors the token/secret fields and is loaded at runtime:

```
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=my-org
GITHUB_REPO=frontend
SLACK_USER_TOKEN=xoxp-...
SLACK_CHANNEL_ID=C0XXXXXXX
ANTHROPIC_API_KEY=sk-ant-...
```

Both files are updated automatically by `setup` and `update`.

### Schedule format (cron)

| Schedule | Meaning |
|---|---|
| `0 9 * * 1-5` | 9:00 AM, Monday-Friday (default) |
| `0 10 * * *` | 10:00 AM, every day |
| `30 8 * * 1-5` | 8:30 AM, weekdays |

---

## `update` Command

Change individual config fields without re-running the full setup wizard.

```bash
standup-cli update <field> <value>
```

Running `standup-cli update` with no arguments shows your current configuration and all available fields.

### Available fields

| Field | Description | Example |
|---|---|---|
| `team-members` | Comma-separated GitHub usernames | `standup-cli update team-members alice,bob,charlie` |
| `repos` | Comma-separated `owner/repo` pairs; first becomes primary | `standup-cli update repos my-org/frontend,my-org/backend` |
| `slack-channel` | Slack channel ID | `standup-cli update slack-channel C0ABC1234` |
| `slack-token` | Slack User OAuth Token | `standup-cli update slack-token xoxp-...` |
| `github-token` | GitHub Personal Access Token | `standup-cli update github-token ghp_...` |
| `anthropic-key` | Anthropic API key | `standup-cli update anthropic-key sk-ant-...` |
| `lookback-hours` | Hours to look back for activity | `standup-cli update lookback-hours 48` |
| `timezone` | IANA timezone | `standup-cli update timezone America/New_York` |
| `schedule` | Cron expression | `standup-cli update schedule "0 10 * * 1-5"` |

Both `config.json` and `.env` are updated together automatically.

---

## Multi-Repo Setup

standup-cli supports fetching activity across multiple GitHub repositories.

### Via the setup wizard

During `standup-cli setup`, after entering your primary repo, you'll be prompted:

```
Additional repositories? (comma-separated owner/repo, e.g. my-org/backend,my-org/infra — or Enter to skip):
```

The primary repo plus any extras are stored in `github_repos`.

### Via the `update` command

```bash
standup-cli update repos my-org/frontend,my-org/backend,my-org/infra
```

The first repo becomes the primary (`github_owner`/`github_repo`), and all are stored in `github_repos`.

### Via manual JSON

Edit `~/.standup-cli/config.json`:

```json
{
  "github_repos": [
    { "owner": "my-org", "repo": "frontend" },
    { "owner": "my-org", "repo": "backend" },
    { "owner": "my-org", "repo": "infrastructure" }
  ],
  "github_owner": "my-org",
  "github_repo": "frontend"
}
```

- `github_repos` is used by agent mode to query all listed repositories.
- `github_owner` / `github_repo` is used by pipeline mode (`run`) and as a fallback when `github_repos` is not set.

---

## API Keys & Tokens

### GitHub Personal Access Token

1. Go to **GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic)**
   Direct link: https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Select scopes: `repo`, `read:org`
4. Copy the token (starts with `ghp_...`)

**For organization repos with SSO/SAML:** After creating the token, click **"Configure SSO"** next to it and **"Authorize"** it for your organization. Without this, you'll get 404 errors on org repos.

### Anthropic API Key

1. Go to https://console.anthropic.com/settings/keys
2. Click **"Create Key"**
3. Copy the key (starts with `sk-ant-...`)
4. Make sure you have credits or a payment method on your Anthropic account

The tool uses `claude-haiku-4-5` (pipeline) and `claude-sonnet-4-5` (agent) — typical cost is under $0.05 per standup run.

### Slack User OAuth Token

1. Go to https://api.slack.com/apps and click **"Create New App"** > **"From scratch"**
2. Give it a name (e.g. "Standup Bot") and select your workspace
3. Go to **OAuth & Permissions** in the sidebar
4. Under **User Token Scopes**, add: `chat:write`, `channels:read`
5. Click **"Install to Workspace"** and approve
6. Copy the **User OAuth Token** (starts with `xoxp-...`)

### Slack Channel ID

1. Open Slack **in your browser** (not the desktop app)
2. Navigate to your standup channel
3. Look at the URL: `https://app.slack.com/client/T0XXXXX/C0XXXXX`
4. The `C0XXXXX` part is your Channel ID

Alternatively, right-click the channel name in the Slack desktop app > **"View channel details"** > scroll to the bottom to find the Channel ID.

---

## Running in the Background

The `standup-cli schedule` command needs to keep running. Here are ways to keep it alive:

**Option 1 — pm2 (recommended)**

```bash
npm install -g pm2
pm2 start standup-cli -- schedule
pm2 save
pm2 startup  # auto-start on reboot
```

**Option 2 — nohup**

```bash
nohup standup-cli schedule > ~/standup.log 2>&1 &
```

**Option 3 — System cron (run once daily instead of scheduler)**

```bash
crontab -e
# Add:
0 9 * * 1-5 standup-cli run >> ~/standup.log 2>&1
```

---

## Troubleshooting

**"Configuration not found"**
Run `standup-cli setup` first.

**404 error on GitHub API**
- Check that `github_owner` is the **org or user that owns the repo**, not your personal username
- For org repos with SSO, authorize your token: GitHub > Settings > Tokens > Configure SSO > Authorize

**Slack message not appearing**
- Verify your `SLACK_USER_TOKEN` starts with `xoxp-`
- Verify the Channel ID starts with `C`
- Make sure the Slack app is installed to your workspace
- Check that the bot has been invited to the channel

**AI summarization failed**
- Verify your Anthropic API key is correct and has credits
- Check https://console.anthropic.com/settings/usage for your balance

**GitHub rate limits**
The GitHub API allows 5,000 requests/hour with a PAT. For very large teams (10+ members) or very active repos, you might occasionally hit this.

---

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

```bash
# Clone and set up for development
git clone https://github.com/Ram479/standup-cli.git
cd standup-cli
npm install

# Run in dev mode (no build needed)
npx tsx src/cli.ts setup
npx tsx src/cli.ts run

# Build
npm run build
```

---

## License

MIT
