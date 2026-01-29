import type { Database } from "@vps-claude/db";
import type { QueueClient } from "@vps-claude/queue";
import type {
  BoxCronjobExecutionId,
  BoxCronjobId,
  BoxId,
} from "@vps-claude/shared";

import {
  box,
  boxCronjob,
  boxCronjobExecution,
  type BoxCronjob,
  type BoxCronjobExecution,
  type BoxCronjobExecutionStatus,
} from "@vps-claude/db";
import { CronExpressionParser } from "cron-parser";
import { desc, eq } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";

export type CronjobServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "VALIDATION_FAILED"; message: string }
  | { type: "BOX_NOT_RUNNING"; message: string }
  | { type: "FORBIDDEN"; message: string }
  | { type: "INTERNAL_ERROR"; message: string };

interface CronjobServiceDeps {
  db: Database;
  queueClient: QueueClient;
}

export interface CreateCronjobInput {
  name: string;
  schedule: string;
  prompt: string;
}

export interface UpdateCronjobInput {
  name?: string;
  schedule?: string;
  prompt?: string;
  enabled?: boolean;
}

function validateCronExpression(
  schedule: string
): Result<Date, CronjobServiceError> {
  try {
    const expression = CronExpressionParser.parse(schedule);
    return ok(expression.next().toDate());
  } catch {
    return err({
      type: "VALIDATION_FAILED",
      message: `Invalid cron expression: ${schedule}`,
    });
  }
}

function calculateNextRunAt(schedule: string, timezone: string): Date | null {
  try {
    const expression = CronExpressionParser.parse(schedule, { tz: timezone });
    return expression.next().toDate();
  } catch {
    return null;
  }
}

export function createCronjobService({ deps }: { deps: CronjobServiceDeps }) {
  const { db, queueClient } = deps;

  const syncRepeatableJob = async (
    cronjob: BoxCronjob
  ): Promise<Result<string, CronjobServiceError>> => {
    const jobKey = `cronjob-${cronjob.id}`;

    // Remove existing job if any
    if (cronjob.bullmqJobKey) {
      try {
        await queueClient.triggerCronjobQueue.removeRepeatableByKey(
          cronjob.bullmqJobKey
        );
      } catch {
        // Ignore if job doesn't exist
      }
    }

    // If disabled, don't create new job
    if (!cronjob.enabled) {
      return ok(jobKey);
    }

    // Add new repeatable job
    await queueClient.triggerCronjobQueue.add(
      "trigger",
      { cronjobId: cronjob.id, boxId: cronjob.boxId },
      {
        repeat: {
          pattern: cronjob.schedule,
          tz: cronjob.timezone,
        },
        jobId: jobKey,
      }
    );

    // Get the actual key from BullMQ
    const repeatableJobs =
      await queueClient.triggerCronjobQueue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === jobKey);
    const actualKey = job?.key ?? jobKey;

    // Update bullmqJobKey in DB
    await db
      .update(boxCronjob)
      .set({ bullmqJobKey: actualKey })
      .where(eq(boxCronjob.id, cronjob.id));

    return ok(actualKey);
  };

  const removeRepeatableJob = async (
    jobKey: string | null
  ): Promise<Result<void, CronjobServiceError>> => {
    if (!jobKey) return ok(undefined);

    try {
      await queueClient.triggerCronjobQueue.removeRepeatableByKey(jobKey);
    } catch {
      // Ignore if job doesn't exist
    }
    return ok(undefined);
  };

  return {
    async create(
      boxId: BoxId,
      input: CreateCronjobInput
    ): Promise<Result<BoxCronjob, CronjobServiceError>> {
      // Validate cron expression
      const validationResult = validateCronExpression(input.schedule);
      if (validationResult.isErr()) return err(validationResult.error);

      const timezone = "UTC";
      const nextRunAt = calculateNextRunAt(input.schedule, timezone);

      const result = await db
        .insert(boxCronjob)
        .values({
          boxId,
          name: input.name,
          schedule: input.schedule,
          prompt: input.prompt,
          timezone,
          nextRunAt,
        })
        .returning();

      const created = result[0];
      if (!created) {
        return err({
          type: "INTERNAL_ERROR",
          message: "Failed to create cronjob",
        });
      }

      // Sync BullMQ repeatable job
      await syncRepeatableJob(created);

      return ok(created);
    },

    async update(
      id: BoxCronjobId,
      input: UpdateCronjobInput
    ): Promise<Result<BoxCronjob, CronjobServiceError>> {
      const existing = await db.query.boxCronjob.findFirst({
        where: eq(boxCronjob.id, id),
      });

      if (!existing) {
        return err({ type: "NOT_FOUND", message: "Cronjob not found" });
      }

      // Validate cron expression if provided
      if (input.schedule) {
        const validationResult = validateCronExpression(input.schedule);
        if (validationResult.isErr()) return err(validationResult.error);
      }

      const timezone = existing.timezone;
      const schedule = input.schedule ?? existing.schedule;
      const nextRunAt = calculateNextRunAt(schedule, timezone);

      const result = await db
        .update(boxCronjob)
        .set({
          ...input,
          nextRunAt,
        })
        .where(eq(boxCronjob.id, id))
        .returning();

      const updated = result[0];
      if (!updated) {
        return err({
          type: "INTERNAL_ERROR",
          message: "Failed to update cronjob",
        });
      }

      // Re-sync BullMQ job
      await syncRepeatableJob(updated);

      return ok(updated);
    },

    async delete(id: BoxCronjobId): Promise<Result<void, CronjobServiceError>> {
      const existing = await db.query.boxCronjob.findFirst({
        where: eq(boxCronjob.id, id),
      });

      if (!existing) {
        return err({ type: "NOT_FOUND", message: "Cronjob not found" });
      }

      // Remove BullMQ job first
      await removeRepeatableJob(existing.bullmqJobKey);

      // Delete from DB (executions will cascade)
      await db.delete(boxCronjob).where(eq(boxCronjob.id, id));

      return ok(undefined);
    },

    async getById(
      id: BoxCronjobId
    ): Promise<Result<BoxCronjob | null, CronjobServiceError>> {
      const result = await db.query.boxCronjob.findFirst({
        where: eq(boxCronjob.id, id),
      });
      return ok(result ?? null);
    },

    async listByBox(
      boxId: BoxId
    ): Promise<Result<BoxCronjob[], CronjobServiceError>> {
      const results = await db.query.boxCronjob.findMany({
        where: eq(boxCronjob.boxId, boxId),
        orderBy: desc(boxCronjob.createdAt),
      });
      return ok(results);
    },

    async toggle(
      id: BoxCronjobId
    ): Promise<Result<BoxCronjob, CronjobServiceError>> {
      const existing = await db.query.boxCronjob.findFirst({
        where: eq(boxCronjob.id, id),
      });

      if (!existing) {
        return err({ type: "NOT_FOUND", message: "Cronjob not found" });
      }

      const result = await db
        .update(boxCronjob)
        .set({ enabled: !existing.enabled })
        .where(eq(boxCronjob.id, id))
        .returning();

      const updated = result[0];
      if (!updated) {
        return err({
          type: "INTERNAL_ERROR",
          message: "Failed to toggle cronjob",
        });
      }

      // Re-sync BullMQ job
      await syncRepeatableJob(updated);

      return ok(updated);
    },

    async listExecutions(
      cronjobId: BoxCronjobId,
      limit = 20
    ): Promise<Result<BoxCronjobExecution[], CronjobServiceError>> {
      const results = await db.query.boxCronjobExecution.findMany({
        where: eq(boxCronjobExecution.cronjobId, cronjobId),
        orderBy: desc(boxCronjobExecution.startedAt),
        limit,
      });
      return ok(results);
    },

    async createExecution(
      cronjobId: BoxCronjobId
    ): Promise<Result<BoxCronjobExecution, CronjobServiceError>> {
      const result = await db
        .insert(boxCronjobExecution)
        .values({
          cronjobId,
          status: "pending",
        })
        .returning();

      const created = result[0];
      if (!created) {
        return err({
          type: "INTERNAL_ERROR",
          message: "Failed to create execution",
        });
      }

      return ok(created);
    },

    async updateExecution(
      id: BoxCronjobExecutionId,
      updates: {
        status?: BoxCronjobExecutionStatus;
        completedAt?: Date;
        durationMs?: number;
        errorMessage?: string;
        result?: string;
      }
    ): Promise<Result<void, CronjobServiceError>> {
      await db
        .update(boxCronjobExecution)
        .set(updates)
        .where(eq(boxCronjobExecution.id, id));
      return ok(undefined);
    },

    async updateLastRunAt(
      id: BoxCronjobId
    ): Promise<Result<void, CronjobServiceError>> {
      const existing = await db.query.boxCronjob.findFirst({
        where: eq(boxCronjob.id, id),
      });

      if (!existing) {
        return err({ type: "NOT_FOUND", message: "Cronjob not found" });
      }

      const nextRunAt = calculateNextRunAt(
        existing.schedule,
        existing.timezone
      );

      await db
        .update(boxCronjob)
        .set({
          lastRunAt: new Date(),
          nextRunAt,
        })
        .where(eq(boxCronjob.id, id));

      return ok(undefined);
    },

    async syncAllRepeatableJobs(): Promise<
      Result<number, CronjobServiceError>
    > {
      // Get all enabled cronjobs
      const cronjobs = await db.query.boxCronjob.findMany({
        where: eq(boxCronjob.enabled, true),
      });

      let count = 0;
      for (const cj of cronjobs) {
        // Check if box is running
        const boxRecord = await db.query.box.findFirst({
          where: eq(box.id, cj.boxId),
        });

        if (boxRecord?.status === "running") {
          await syncRepeatableJob(cj);
          count++;
        }
      }

      return ok(count);
    },

    async getBoxForCronjob(
      cronjobId: BoxCronjobId
    ): Promise<
      Result<{ boxId: BoxId; spriteUrl: string | null }, CronjobServiceError>
    > {
      const cronjobRecord = await db.query.boxCronjob.findFirst({
        where: eq(boxCronjob.id, cronjobId),
      });

      if (!cronjobRecord) {
        return err({ type: "NOT_FOUND", message: "Cronjob not found" });
      }

      const boxRecord = await db.query.box.findFirst({
        where: eq(box.id, cronjobRecord.boxId),
      });

      if (!boxRecord) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      return ok({
        boxId: boxRecord.id,
        spriteUrl: boxRecord.spriteUrl,
      });
    },
  };
}

export type CronjobService = ReturnType<typeof createCronjobService>;
