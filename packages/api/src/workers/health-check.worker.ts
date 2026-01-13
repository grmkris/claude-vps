import type { Database } from "@vps-claude/db";
import type { DockerEngineClient } from "@vps-claude/docker-engine";
import type { Logger } from "@vps-claude/logger";

import { box } from "@vps-claude/db";
import { eq, inArray } from "drizzle-orm";

interface HealthCheckWorkerDeps {
  dockerClient: DockerEngineClient;
  db: Database;
  logger: Logger;
}

const HEALTH_CHECK_INTERVAL = 30_000; // 30 seconds

export function startHealthCheckWorker(deps: HealthCheckWorkerDeps) {
  const { logger } = deps;

  logger.info("Starting health check worker");

  // Run immediately
  void runHealthCheck(deps);

  // Then every 30s
  setInterval(() => {
    void runHealthCheck(deps);
  }, HEALTH_CHECK_INTERVAL);
}

async function runHealthCheck(deps: HealthCheckWorkerDeps) {
  const { dockerClient, db, logger } = deps;

  try {
    // Get all boxes that should be running
    const boxes = await db.query.box.findMany({
      where: inArray(box.status, ["running", "deploying"]),
    });

    for (const boxRecord of boxes) {
      if (!boxRecord.dockerContainerId) {
        continue;
      }

      try {
        const container = dockerClient.docker.getContainer(
          boxRecord.dockerContainerId
        );
        const info = await container.inspect();

        let newStatus: "running" | "stopped" | "error";
        if (!info.State.Running) {
          newStatus = "stopped";
        } else if (info.State.Health?.Status === "unhealthy") {
          newStatus = "error";
        } else {
          newStatus = "running";
        }

        // Update DB if status changed
        if (boxRecord.status !== newStatus) {
          await db
            .update(box)
            .set({
              status: newStatus,
              lastHealthCheck: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(box.id, boxRecord.id));

          logger.info(
            {
              boxId: boxRecord.id,
              subdomain: boxRecord.subdomain,
              oldStatus: boxRecord.status,
              newStatus,
            },
            "Box status changed"
          );
        } else {
          // Just update last health check timestamp
          await db
            .update(box)
            .set({
              lastHealthCheck: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(box.id, boxRecord.id));
        }
      } catch (err) {
        logger.error(
          {
            boxId: boxRecord.id,
            subdomain: boxRecord.subdomain,
            error: err instanceof Error ? err.message : String(err),
          },
          "Health check failed for box"
        );

        // Mark as error if container disappeared
        await db
          .update(box)
          .set({
            status: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(box.id, boxRecord.id));
      }
    }

    logger.debug({ count: boxes.length }, "Health check completed");
  } catch (err) {
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      "Health check worker failed"
    );
  }
}
