import { eq, sql } from "drizzle-orm";
import { watch, mkdirSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";

import { db } from "../db";
import { executionState } from "../db/schema";
import { logger } from "../logger";

const IDLE_THRESHOLD_MS = 30_000; // 30 seconds

interface ActiveFile {
  lastModified: number;
  lineCount: number;
}

export function startExecutionWatcher(): {
  watcher: FSWatcher;
  idleChecker: ReturnType<typeof setInterval>;
} {
  const home = homedir();
  const homeSuffix = home.replace(/\//g, "-");
  const projectDir = `${home}/.claude/projects/${homeSuffix}`;

  mkdirSync(projectDir, { recursive: true });

  // Reset stale "running" state from previous crashes
  db.update(executionState)
    .set({ status: "idle" })
    .where(eq(executionState.status, "running"))
    .run();

  const activeFiles = new Map<string, ActiveFile>();

  const watcher = watch(projectDir, { persistent: true }, (event, filename) => {
    if (!filename?.endsWith(".jsonl")) return;

    const filePath = `${projectDir}/${filename}`;
    const sessionId = filename.replace(".jsonl", "");

    if (event === "rename") {
      void Bun.file(filePath)
        .exists()
        .then((exists) => {
          const now = Date.now();
          if (exists) {
            onSessionStarted(sessionId, filePath);
            activeFiles.set(filePath, { lastModified: now, lineCount: 0 });
          } else {
            onSessionIdle(sessionId, filePath);
            activeFiles.delete(filePath);
          }
        });
    }

    if (event === "change") {
      const prev = activeFiles.get(filePath);
      void countLines(filePath).then((newLineCount) => {
        const now = Date.now();
        const newLines = newLineCount - (prev?.lineCount ?? 0);
        onSessionActivity(filePath, newLines);
        activeFiles.set(filePath, {
          lastModified: now,
          lineCount: newLineCount,
        });
      });
    }
  });

  const idleChecker = setInterval(() => {
    const now = Date.now();
    for (const [filePath, state] of activeFiles) {
      if (now - state.lastModified > IDLE_THRESHOLD_MS) {
        const sessionId = filePath.split("/").pop()?.replace(".jsonl", "");
        if (sessionId) {
          onSessionIdle(sessionId, filePath);
        }
        activeFiles.delete(filePath);
      }
    }
  }, 5000);

  logger.info({ projectDir }, "[watcher] Execution watcher started");

  return { watcher, idleChecker };
}

function onSessionStarted(sessionId: string, filePath: string) {
  const now = Date.now();
  db.insert(executionState)
    .values({
      sessionFile: filePath,
      sessionId,
      status: "running",
      startedAt: now,
      lastActivityAt: now,
      messageCount: 0,
    })
    .onConflictDoUpdate({
      target: executionState.sessionFile,
      set: { status: "running", lastActivityAt: now },
    })
    .run();

  logger.info({ sessionId }, "[watcher] Session started");
}

function onSessionActivity(filePath: string, newLines: number) {
  if (newLines <= 0) return;

  db.update(executionState)
    .set({
      status: "running",
      lastActivityAt: Date.now(),
      messageCount: sql`${executionState.messageCount} + ${newLines}`,
    })
    .where(eq(executionState.sessionFile, filePath))
    .run();
}

function onSessionIdle(sessionId: string, filePath: string) {
  db.update(executionState)
    .set({ status: "idle" })
    .where(eq(executionState.sessionFile, filePath))
    .run();

  logger.info({ sessionId }, "[watcher] Session idle");
}

async function countLines(filePath: string): Promise<number> {
  try {
    const content = await Bun.file(filePath).text();
    return content.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}
