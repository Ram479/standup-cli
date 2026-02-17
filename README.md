# standup-cli

**AI-powered daily standup generator for teams.**

Pulls each team member's GitHub activity (commits, PRs, issues) from the last 24 hours, summarizes it with Claude AI, and posts formatted standup notes to your Slack channel — every morning, on autopilot.

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
npm install -g standup-cli
```

Or run directly without installing:

```bash
npx standup-cli setup
npx standup-cli run
```

### Requirements

- Node.js 18 or higher
- A GitHub Personal Access Token
- An Anthropic API key (you bring your own)
- A Slack User OAuth Token + Channel ID

---

## Quick Start

### Step 1 — Run the setup wizard

```bash
standup-cli setup
```

The wizard will walk you through everything interactively:

1. GitHub token + repo details
2. Team member GitHub usernames
3. Slack token + channel
4. Schedule and timezone
5. Your Anthropic API key

### Step 2 — Test it

```bash
standup-cli run
```

Check your Slack channel — the standup should appear within seconds.

### Step 3 — Schedule daily standups

```bash
standup-cli schedule
```

Runs every morning at the time you configured (default: 9 AM weekdays).

---

## Commands

| Command | Alias | Description |
|---|---|---|
| `standup-cli setup` | `configure` | Interactive configuration wizard |
| `standup-cli run` | `-r` | Generate and post standup right now |
| `standup-cli schedule` | `-s` | Start the daily scheduler |
| `standup-cli status` | | Show current configuration |

---

## Getting Your API Keys & Tokens

### 1. GitHub Personal Access Token

You need a token so standup-cli can read commits, PRs, and issues from your repo.

1. Go to **GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic)**
   Direct link: https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Select scopes:
   - `repo` (full control of private repositories)
   - `read:org` (read org membership — needed for org repos)
4. Copy the token (starts with `ghp_...`)

**For organization repos with SSO/SAML:**
After creating the token, click **"Configure SSO"** next to it and **"Authorize"** it for your organization. Without this, you'll get 404 errors on org repos.

### 2. Anthropic API Key

standup-cli uses Claude AI to summarize GitHub activity into standup notes. You need your own Anthropic API key.

1. Go to https://console.anthropic.com/settings/keys
2. Click **"Create Key"**
3. Copy the key (starts with `sk-ant-...`)
4. Make sure you have credits or a payment method on your Anthropic account

The tool uses `claude-haiku-4-5` which is fast and cheap — typical cost is under $0.01 per standup.

### 3. Slack User OAuth Token

You need a Slack app to post messages to your channel.

1. Go to https://api.slack.com/apps and click **"Create New App"** > **"From scratch"**
2. Give it a name (e.g. "Standup Bot") and select your workspace
3. Go to **OAuth & Permissions** in the sidebar
4. Under **User Token Scopes**, add:
   - `chat:write` (post messages)
   - `channels:read` (list channels)
5. Click **"Install to Workspace"** at the top and approve
6. Copy the **User OAuth Token** (starts with `xoxp-...`)

### 4. Slack Channel ID

1. Open Slack **in your browser** (not the desktop app)
2. Navigate to your `#standup` channel (or whichever channel you want)
3. Look at the URL: `https://app.slack.com/client/T0XXXXX/C0XXXXX`
4. The `C0XXXXX` part is your Channel ID

Alternatively, right-click the channel name in the Slack desktop app > **"View channel details"** > scroll to the bottom to find the Channel ID.

---

## Team Members

When the setup wizard asks for team members, enter their **GitHub usernames** (not display names), comma-separated:

```
Team member GitHub usernames: ramkrishna-dev,priya-dev,naveen42
```

These must match the usernames that appear on their GitHub commits and PRs. You can find someone's GitHub username from their profile URL: `github.com/their-username`.

To update team members later, either:
- Re-run `standup-cli setup`
- Or edit `~/.standup-cli/config.json` directly:

```json
{
  "team_members": ["ramkrishna-dev", "priya-dev", "naveen42"]
}
```

---

## Configuration

All config is stored in `~/.standup-cli/`. You can edit these files manually or re-run `standup-cli setup`.

**~/.standup-cli/config.json**
```json
{
  "github_token": "ghp_...",
  "github_owner": "egovernments",
  "github_repo": "DIGIT-Frontend",
  "team_members": ["ramkrishna-dev", "priya-dev"],
  "slack_user_token": "xoxp-...",
  "slack_channel_id": "C0XXXXXXX",
  "anthropic_api_key": "sk-ant-...",
  "lookback_hours": 24,
  "schedule": "0 9 * * 1-5",
  "timezone": "Asia/Kolkata"
}
```

**Schedule format (cron):**

| Schedule | Meaning |
|---|---|
| `0 9 * * 1-5` | 9:00 AM, Monday–Friday (default) |
| `0 10 * * *` | 10:00 AM, every day |
| `30 8 * * 1-5` | 8:30 AM, weekdays |

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
- Check that `github_owner` is the **org or user that owns the repo**, not your personal username (e.g. `egovernments`, not `ramkrishna-dev`)
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
