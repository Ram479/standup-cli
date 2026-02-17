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
    team_members,
    slack_user_token,
    slack_channel_id,
    anthropic_api_key,
    lookback_hours: lookbackInput ? parseInt(lookbackInput) : 24,
    schedule: schedule || "0 9 * * 1-5",
    timezone: timezone || "Asia/Kolkata",
  };

  // Create config directory
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Write config
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  // Write .env file
  const envContent = `GITHUB_TOKEN=${github_token}
GITHUB_OWNER=${github_owner}
GITHUB_REPO=${github_repo}
SLACK_USER_TOKEN=${slack_user_token}
SLACK_CHANNEL_ID=${slack_channel_id}
ANTHROPIC_API_KEY=${anthropic_api_key}
`;

  writeFileSync(ENV_FILE, envContent);

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
