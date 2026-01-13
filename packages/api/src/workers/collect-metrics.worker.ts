import type { Database } from "@vps-claude/db";
import type { DockerEngineClient } from "@vps-claude/docker-engine";
import type { Logger } from "@vps-claude/logger";

import { box } from "@vps-claude/db";
import { eq } from "drizzle-orm";

interface MetricsWorkerDeps {
  dockerClient: DockerEngineClient;
  db: Database;
  logger: Logger;
}

const METRICS_INTERVAL = 60_000; // 60 seconds

export function startMetricsWorker(deps: MetricsWorkerDeps) {
  const { logger } = deps;

  logger.info("Starting metrics collection worker");

  // Run immediately
  void collectMetrics(deps);

  // Then every 60s
  setInterval(() => {
    void collectMetrics(deps);
  }, METRICS_INTERVAL);
}

async function collectMetrics(deps: MetricsWorkerDeps) {
  const { dockerClient, db, logger } = deps;

  try {
    // Get all running boxes
    const boxes = await db.query.box.findMany({
      where: eq(box.status, "running"),
    });

    for (const boxRecord of boxes) {
      if (!boxRecord.dockerContainerId) {
        continue;
      }

      try {
        const stats = await dockerClient.getBoxStats(
          boxRecord.dockerContainerId
        );

        // Log metrics (in production, send to monitoring service or time-series DB)
        logger.debug(
          {
            boxId: boxRecord.id,
            subdomain: boxRecord.subdomain,
            cpuPercent: stats.cpuPercent,
            memoryUsageMB: stats.memoryUsageMB,
            memoryLimitMB: stats.memoryLimitMB,
            memoryPercent: stats.memoryPercent,
            networkRxBytes: stats.networkRxBytes,
            networkTxBytes: stats.networkTxBytes,
          },
          "Box metrics collected"
        );

        // Alert if thresholds exceeded
        if (stats.cpuPercent > 90) {
          logger.warn(
            {
              boxId: boxRecord.id,
              subdomain: boxRecord.subdomain,
              cpuPercent: stats.cpuPercent,
            },
            "High CPU usage detected"
          );
        }

        if (stats.memoryPercent > 90) {
          logger.warn(
            {
              boxId: boxRecord.id,
              subdomain: boxRecord.subdomain,
              memoryPercent: stats.memoryPercent,
            },
            "High memory usage detected"
          );
        }

        // TODO: Store metrics in time-series database or send to monitoring service
        // Example: await metricsDB.insert({ boxId, timestamp: new Date(), ...stats });
      } catch (err) {
        logger.error(
          {
            boxId: boxRecord.id,
            subdomain: boxRecord.subdomain,
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to collect metrics for box"
        );
      }
    }

    logger.debug({ count: boxes.length }, "Metrics collection completed");
  } catch (err) {
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      "Metrics worker failed"
    );
  }
}
