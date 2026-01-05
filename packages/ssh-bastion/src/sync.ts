import { createLogger } from "@vps-claude/logger";

import { fetchRunningBoxes } from "./api-client";
import { env } from "./env";
import { syncConfigs } from "./sshpiper-config";

const logger = createLogger({ appName: "ssh-bastion" });

async function syncOnce(): Promise<void> {
  try {
    logger.info({ msg: "Syncing boxes from API..." });
    const boxes = await fetchRunningBoxes();

    if (boxes.length === 0) {
      logger.info({ msg: "No running boxes found" });
      return;
    }

    await syncConfigs(boxes);
    logger.info({ msg: "Sync complete", boxCount: boxes.length });
  } catch (error) {
    logger.error({
      msg: "Sync failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  logger.info({ msg: "SSH bastion sync service started" });
  logger.info({
    msg: "Config",
    apiUrl: env.API_URL,
    workdir: env.WORKDIR,
    syncInterval: env.SYNC_INTERVAL_MS,
  });

  // Initial sync
  await syncOnce();

  // Continuous sync loop
  setInterval(() => {
    void syncOnce();
  }, env.SYNC_INTERVAL_MS);
}

void main();
