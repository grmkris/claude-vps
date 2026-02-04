/**
 * Check for unread notifications and output summary.
 *
 * Called by Claude Code hooks (PostToolUse, SessionStart).
 * Outputs notification summary to stdout which gets injected into Claude's context.
 */

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
    // Count unread items from local filesystem
    const counts = await countUnreadByType();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    // If no unread items, output nothing (don't clutter the context)
    if (total === 0) {
      return;
    }

    // Format and output the summary
    const summary = formatNotificationSummary(counts);

    if (options.onStart) {
      // On session start, be more prominent
      console.log("\n" + "=".repeat(60));
      console.log("INBOX NOTIFICATIONS");
      console.log("=".repeat(60));
      console.log(summary);
      console.log("=".repeat(60) + "\n");
    } else {
      // After tool use, be brief
      console.log(summary);
    }
  } catch (error) {
    // Silently fail - don't break Claude's flow
    // Could log to stderr for debugging
    console.error(
      `[check-notifications] Error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// Parse CLI args and run
if (import.meta.main) {
  const args = process.argv.slice(2);
  const options: CheckNotificationsOptions = {
    onStart: args.includes("--on-start"),
    sessionKey: args.find((a) => a.startsWith("--session="))?.split("=")[1],
  };

  await checkNotifications(options);
}
