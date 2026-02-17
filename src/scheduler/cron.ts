import cron from "node-cron";

export function startScheduler(
  cronExpression: string,
  timezone: string,
  job: () => Promise<void>
): void {
  console.log(`⏰ Scheduler started — cron: "${cronExpression}" (${timezone})`);
  console.log(`   Next run: ${getNextRunDescription(cronExpression)}`);

  cron.schedule(
    cronExpression,
    async () => {
      console.log(`\n🚀 Running scheduled standup generation — ${new Date().toISOString()}`);
      try {
        await job();
      } catch (error: any) {
        console.error(`❌ Scheduled job failed: ${error.message}`);
      }
    },
    {
      timezone,
    }
  );

  // Keep process alive
  console.log("\nScheduler is running. Press Ctrl+C to stop.\n");
}

function getNextRunDescription(cronExpression: string): string {
  const parts = cronExpression.split(" ");
  if (parts.length === 5) {
    const [minute, hour, , , days] = parts;
    const dayMap: Record<string, string> = {
      "1-5": "weekdays (Mon–Fri)",
      "*": "every day",
      "1": "Mondays",
      "2": "Tuesdays",
      "3": "Wednesdays",
      "4": "Thursdays",
      "5": "Fridays",
    };
    const dayLabel = dayMap[days] ?? days;
    return `${hour}:${minute.padStart(2, "0")} ${dayLabel}`;
  }
  return cronExpression;
}
