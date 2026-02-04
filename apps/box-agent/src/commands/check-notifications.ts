import {
  countUnreadByType,
  formatNotificationSummary,
} from "../utils/agent-inbox";

interface CheckNotificationsOptions {
  onStart?: boolean;
  sessionKey?: string;
}

export async function checkNotifications(
  options: CheckNotificationsOptions = {}
): Promise<void> {
  try {
    const counts = await countUnreadByType();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    if (total === 0) return;

    const summary = formatNotificationSummary(counts);

    if (options.onStart) {
      console.log("\n" + "=".repeat(60));
      console.log("INBOX NOTIFICATIONS");
      console.log("=".repeat(60));
      console.log(summary);
      console.log("=".repeat(60) + "\n");
    } else {
      console.log(summary);
    }
  } catch (error) {
    console.error(
      `[check-notifications] Error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const options: CheckNotificationsOptions = {
    onStart: args.includes("--on-start"),
    sessionKey: args.find((a) => a.startsWith("--session="))?.split("=")[1],
  };

  await checkNotifications(options);
}
