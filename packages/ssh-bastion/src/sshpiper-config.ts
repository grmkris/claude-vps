import { createLogger } from "@vps-claude/logger";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BoxInfo } from "./api-client";

import { env } from "./env";

const logger = createLogger({ appName: "ssh-bastion" });

function generateConfig(box: BoxInfo): string {
  return `# Auto-generated config for box: ${box.subdomain}
version: "1.0"
from:
  - username: ".*"
    username_regex_match: true
to:
  host: "${box.containerName}"
  port: 22
  username: "coder"
  ignore_hostkey: true
`;
}

export async function syncConfigs(boxes: BoxInfo[]): Promise<void> {
  for (const box of boxes) {
    const boxDir = join(env.WORKDIR, box.subdomain);
    await mkdir(boxDir, { recursive: true });

    const configPath = join(boxDir, "sshpiper.yaml");
    const config = generateConfig(box);
    await writeFile(configPath, config);

    logger.info({
      msg: "Created config",
      subdomain: box.subdomain,
      target: `${box.containerName}:22`,
    });
  }
}

export async function cleanupStaleConfigs(
  currentBoxes: BoxInfo[]
): Promise<void> {
  const currentSubdomains = new Set(currentBoxes.map((b) => b.subdomain));

  let existingDirs: string[];
  try {
    existingDirs = await readdir(env.WORKDIR);
  } catch {
    // WORKDIR doesn't exist yet, nothing to clean
    return;
  }

  for (const dir of existingDirs) {
    if (!currentSubdomains.has(dir)) {
      try {
        await rm(join(env.WORKDIR, dir), { recursive: true });
        logger.info({ msg: "Removed stale config", subdomain: dir });
      } catch (error) {
        logger.error({
          msg: "Failed to remove stale config",
          subdomain: dir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
