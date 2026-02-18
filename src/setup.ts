import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import * as readline from "readline/promises";

const CONFIG_DIR = join(homedir(), ".standup-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const ENV_FILE = join(CONFIG_DIR, ".env");

interface SetupConfig {
  github_token: string;
  github_owner: string;
  github_repo: string;
  github_repos?: { owner: string; repo: string }[];
  team_members: string[];
  slack_user_token: string;
  slack_channel_id: string;
  anthropic_api_key: string;
  lookback_hours: number;
  schedule: string;
  timezone: string;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function maskSecret(value: string): string {
  if (!value || value.length < 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

function writeConfig(config: SetupConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  const envContent = `GITHUB_TOKEN=${config.github_token}
GITHUB_OWNER=${config.github_owner}
GITHUB_REPO=${config.github_repo}
SLACK_USER_TOKEN=${config.slack_user_token}
SLACK_CHANNEL_ID=${config.slack_channel_id}
ANTHROPIC_API_KEY=${config.anthropic_api_key}
`;

  writeFileSync(ENV_FILE, envContent);
}

export async function runSetupWizard(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   Welcome to standup-cli Setup Wizard 🚀          ║
║                                                   ║
║   This will guide you through the configuration  ║
║   step by step. Press Ctrl+C anytime to exit.   ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
`);

  console.log("\n📋 Let's start with GitHub configuration...\n");

  const github_token = await prompt(
    "GitHub Personal Access Token (scopes: repo, read:org): "
  );
  const github_owner = await prompt("GitHub owner (username or org): ");
  const github_repo = await prompt("GitHub repository name: ");

  const extraReposInput = await prompt(
    "Additional repositories? (comma-separated owner/repo, e.g. my-org/backend,my-org/infra — or Enter to skip): "
  );

  let github_repos: { owner: string; repo: string }[] = [
    { owner: github_owner, repo: github_repo },
  ];

  if (extraReposInput) {
    const extras = extraReposInput.split(",").map((r) => r.trim()).filter(Boolean);
    for (const entry of extras) {
      const parts = entry.split("/");
      if (parts.length === 2 && parts[0] && parts[1]) {
        github_repos.push({ owner: parts[0], repo: parts[1] });
      } else {
        console.log(`   ⚠️  Skipping invalid repo format: "${entry}" (expected owner/repo)`);
      }
    }
  }

  console.log("\n👥 Team configuration...\n");

  const teamInput = await prompt(
    "Team member GitHub usernames (comma-separated, e.g. ram,priya,naveen): "
  );
  const team_members = teamInput.split(",").map((u) => u.trim());

  console.log("\n💬 Slack configuration...\n");
  console.log("   To get your Slack User Token:");
  console.log("   1. Go to api.slack.com/apps → Create New App");
  console.log("   2. Add scopes: chat:write, channels:read");
  console.log("   3. Install to workspace → copy User OAuth Token (xoxp-...)\n");

  const slack_user_token = await prompt("Slack User OAuth Token (xoxp-...): ");

  console.log(
    "\n   To get your Channel ID: Open Slack in browser → go to #standup"
  );
  console.log("   The URL shows: .../client/T0XXXXX/C0XXXXX (copy the C0XXXXX part)\n");

  const slack_channel_id = await prompt("Slack Channel ID (C0...): ");

  console.log("\n⏰ Schedule configuration...\n");

  const schedule = await prompt(
    'Cron schedule (default: "0 9 * * 1-5" = 9 AM weekdays) [press Enter to use default]: '
  );
  const timezone = await prompt(
    'Timezone (default: "Asia/Kolkata") [press Enter to use default]: '
  );
  const lookbackInput = await prompt(
    "Lookback hours (default: 24) [press Enter to use default]: "
  );

  console.log("\n🤖 Anthropic API Key...\n");
  console.log("   Get your key from: console.anthropic.com/settings/keys\n");

  const anthropic_api_key = await prompt(
    "Anthropic API Key (sk-ant-...): "
  );

  if (!anthropic_api_key) {
    console.error("\n❌ Anthropic API key is required. Get one at: console.anthropic.com/settings/keys\n");
    process.exit(1);
  }

  const config: SetupConfig = {
    github_token,
    github_owner,
    github_repo,
    github_repos,
    team_members,
    slack_user_token,
    slack_channel_id,
    anthropic_api_key,
    lookback_hours: lookbackInput ? parseInt(lookbackInput) : 24,
    schedule: schedule || "0 9 * * 1-5",
    timezone: timezone || "Asia/Kolkata",
  };

  writeConfig(config);

  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   ✅ Setup complete!                              ║
║                                                   ║
║   Configuration saved to:                        ║
║   ${CONFIG_FILE.padEnd(49, ' ')}║
║                                                   ║
║   Next steps:                                    ║
║   • Test it: standup-cli run                     ║
║   • Schedule: standup-cli schedule               ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
`);
}

export function loadConfig(): SetupConfig {
  if (!existsSync(CONFIG_FILE)) {
    console.error("❌ Configuration not found. Run: standup-cli setup");
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
}

export function getEnvPath(): string {
  return ENV_FILE;
}

export function showCurrentConfig(): void {
  const config = loadConfig();

  const repos: { owner: string; repo: string }[] = config.github_repos ?? [
    { owner: config.github_owner, repo: config.github_repo },
  ];

  console.log(`
┌─────────────────────────────────────────────────┐
│  standup-cli — Current Configuration            │
├──────────────────┬──────────────────────────────┤
│  Repos           │  ${repos.map((r) => `${r.owner}/${r.repo}`).join(", ").slice(0, 28).padEnd(28, " ")}│
│  Team members    │  ${config.team_members.join(", ").slice(0, 28).padEnd(28, " ")}│
│  Schedule        │  ${config.schedule.padEnd(28, " ")}│
│  Timezone        │  ${config.timezone.padEnd(28, " ")}│
│  Lookback hours  │  ${String(config.lookback_hours).padEnd(28, " ")}│
│  Slack channel   │  ${config.slack_channel_id.padEnd(28, " ")}│
│  Slack token     │  ${maskSecret(config.slack_user_token).padEnd(28, " ")}│
│  GitHub token    │  ${maskSecret(config.github_token).padEnd(28, " ")}│
│  Anthropic key   │  ${maskSecret(config.anthropic_api_key).padEnd(28, " ")}│
└──────────────────┴──────────────────────────────┘`);

  if (repos.length > 1) {
    console.log("\n  All repositories:");
    for (const r of repos) {
      console.log(`    - ${r.owner}/${r.repo}`);
    }
  }

  console.log();
}

export function showUpdateHelp(): void {
  console.log(`
Usage: standup-cli update <field> <value>

Available fields:
  team-members   Comma-separated GitHub usernames
  repos          Comma-separated owner/repo pairs (first becomes primary)
  slack-channel  Slack channel ID (C0XXXXXXX)
  slack-token    Slack User OAuth Token (xoxp-...)
  github-token   GitHub Personal Access Token (ghp_...)
  anthropic-key  Anthropic API Key (sk-ant-...)
  lookback-hours Number of hours to look back (e.g. 24)
  timezone       Timezone (e.g. Asia/Kolkata)
  schedule       Cron schedule (e.g. "0 9 * * 1-5")

Examples:
  standup-cli update team-members alice,bob,charlie
  standup-cli update repos my-org/frontend,my-org/backend
  standup-cli update slack-channel C0ABC1234
  standup-cli update lookback-hours 48
  standup-cli update timezone America/New_York
  standup-cli update schedule "0 10 * * 1-5"
`);
}

export function updateConfig(field: string, value: string): void {
  if (!value) {
    console.error(`❌ Value is required. Usage: standup-cli update ${field} <value>`);
    process.exit(1);
  }

  const config = loadConfig();

  switch (field) {
    case "team-members": {
      const members = value.split(",").map((m) => m.trim()).filter(Boolean);
      if (members.length === 0) {
        console.error("❌ At least one team member is required.");
        process.exit(1);
      }
      config.team_members = members;
      break;
    }

    case "repos": {
      const repoPairs = value.split(",").map((r) => r.trim()).filter(Boolean);
      const parsed: { owner: string; repo: string }[] = [];
      for (const entry of repoPairs) {
        const parts = entry.split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          console.error(`❌ Invalid repo format: "${entry}". Expected owner/repo.`);
          process.exit(1);
        }
        parsed.push({ owner: parts[0], repo: parts[1] });
      }
      if (parsed.length === 0) {
        console.error("❌ At least one repository is required.");
        process.exit(1);
      }
      config.github_repos = parsed;
      config.github_owner = parsed[0].owner;
      config.github_repo = parsed[0].repo;
      break;
    }

    case "slack-channel":
      config.slack_channel_id = value;
      break;

    case "slack-token":
      config.slack_user_token = value;
      break;

    case "github-token":
      config.github_token = value;
      break;

    case "anthropic-key":
      config.anthropic_api_key = value;
      break;

    case "lookback-hours": {
      const hours = parseInt(value, 10);
      if (isNaN(hours) || hours <= 0) {
        console.error("❌ lookback-hours must be a positive number.");
        process.exit(1);
      }
      config.lookback_hours = hours;
      break;
    }

    case "timezone":
      config.timezone = value;
      break;

    case "schedule":
      config.schedule = value;
      break;

    default:
      console.error(`❌ Unknown field: "${field}"`);
      showUpdateHelp();
      process.exit(1);
  }

  writeConfig(config);
  console.log(`✅ Updated ${field} to ${value}`);
}
