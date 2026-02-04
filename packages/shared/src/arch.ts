import os from "node:os";

const BASE_URL =
  "https://github.com/grmkris/claude-vps/releases/latest/download";

export function getBoxAgentBinaryUrl(override?: string): string {
  if (override) return override;

  const arch = os.arch();
  const suffix = arch === "arm64" ? "arm64" : "x64";

  return `${BASE_URL}/box-agent-linux-${suffix}`;
}
