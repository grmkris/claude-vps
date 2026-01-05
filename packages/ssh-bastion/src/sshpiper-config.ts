import { createLogger } from "@vps-claude/logger";
import { mkdir, writeFile } from "node:fs/promises";
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
