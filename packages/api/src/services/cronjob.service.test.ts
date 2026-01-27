import type { BoxCronjob } from "@vps-claude/db";
import type { BoxId } from "@vps-claude/shared";

import { typeIdGenerator } from "@vps-claude/shared";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createBoxService, type BoxService } from "./box.service";
import {
  createCronjobService,
  type CreateCronjobInput,
  type CronjobService,
} from "./cronjob.service";

describe("CronjobService", () => {
  let testEnv: TestSetup;
  let cronjobService: CronjobService;
  let boxService: BoxService;

  beforeAll(async () => {
    testEnv = await createTestSetup();
    cronjobService = createCronjobService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
    boxService = createBoxService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
  });

  afterAll(async () => {
    await testEnv.close();
  });

  async function createTestBox(name: string): Promise<BoxId> {
    const result = await boxService.create(testEnv.users.authenticated.id, {
      name,
    });
    return result._unsafeUnwrap().id;
  }

  async function createTestCronjob(
    boxId: BoxId,
    overrides?: Partial<CreateCronjobInput>
  ): Promise<BoxCronjob> {
    const result = await cronjobService.create(boxId, {
      name: "Test Job",
      schedule: "0 9 * * *",
      prompt: "Do something",
      ...overrides,
    });
    return result._unsafeUnwrap();
  }

  test("create cronjob with valid cron", async () => {
    const boxId = await createTestBox("create-cron-test");
    const result = await cronjobService.create(boxId, {
      name: "Daily Task",
      schedule: "0 9 * * *",
      prompt: "Run daily report",
    });

    const cronjob = result._unsafeUnwrap();
    expect(cronjob.name).toBe("Daily Task");
    expect(cronjob.schedule).toBe("0 9 * * *");
    expect(cronjob.prompt).toBe("Run daily report");
    expect(cronjob.timezone).toBe("UTC");
    expect(cronjob.enabled).toBe(true);
    expect(cronjob.nextRunAt).toBeDefined();
    expect(cronjob.boxId).toBe(boxId);
  });

  test("create cronjob with custom timezone", async () => {
    const boxId = await createTestBox("timezone-test");
    const result = await cronjobService.create(boxId, {
      name: "NY Task",
      schedule: "0 9 * * *",
      prompt: "Morning task",
      timezone: "America/New_York",
    });

    const cronjob = result._unsafeUnwrap();
    expect(cronjob.timezone).toBe("America/New_York");
  });

  test("create rejects invalid cron expression", async () => {
    const boxId = await createTestBox("invalid-cron-test");
    const result = await cronjobService.create(boxId, {
      name: "Bad Cron",
      schedule: "invalid cron",
      prompt: "Won't work",
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("VALIDATION_FAILED");
    expect(error.message).toContain("Invalid cron expression");
  });

  test("update cronjob", async () => {
    const boxId = await createTestBox("update-test");
    const cronjob = await createTestCronjob(boxId);

    const result = await cronjobService.update(cronjob.id, {
      name: "Updated Name",
      schedule: "0 10 * * *",
      prompt: "Updated prompt",
    });

    const updated = result._unsafeUnwrap();
    expect(updated.name).toBe("Updated Name");
    expect(updated.schedule).toBe("0 10 * * *");
    expect(updated.prompt).toBe("Updated prompt");
  });

  test("update rejects invalid cron", async () => {
    const boxId = await createTestBox("update-invalid-test");
    const cronjob = await createTestCronjob(boxId);

    const result = await cronjobService.update(cronjob.id, {
      schedule: "not a cron",
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("VALIDATION_FAILED");
  });

  test("update non-existent returns NOT_FOUND", async () => {
    const fakeId = typeIdGenerator("boxCronjob");
    const result = await cronjobService.update(fakeId, {
      name: "New Name",
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("NOT_FOUND");
  });

  test("delete removes cronjob", async () => {
    const boxId = await createTestBox("delete-test");
    const cronjob = await createTestCronjob(boxId);

    const deleteResult = await cronjobService.delete(cronjob.id);
    deleteResult._unsafeUnwrap();

    const getResult = await cronjobService.getById(cronjob.id);
    const deleted = getResult._unsafeUnwrap();
    expect(deleted).toBeNull();
  });

  test("delete non-existent returns NOT_FOUND", async () => {
    const fakeId = typeIdGenerator("boxCronjob");
    const result = await cronjobService.delete(fakeId);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("NOT_FOUND");
  });

  test("toggle flips enabled state", async () => {
    const boxId = await createTestBox("toggle-test");
    const cronjob = await createTestCronjob(boxId);
    expect(cronjob.enabled).toBe(true);

    // Toggle to disabled
    const result1 = await cronjobService.toggle(cronjob.id);
    const toggled1 = result1._unsafeUnwrap();
    expect(toggled1.enabled).toBe(false);

    // Toggle back to enabled
    const result2 = await cronjobService.toggle(cronjob.id);
    const toggled2 = result2._unsafeUnwrap();
    expect(toggled2.enabled).toBe(true);
  });

  test("toggle non-existent returns NOT_FOUND", async () => {
    const fakeId = typeIdGenerator("boxCronjob");
    const result = await cronjobService.toggle(fakeId);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("NOT_FOUND");
  });

  test("listByBox returns box cronjobs", async () => {
    const boxId = await createTestBox("list-test");
    await createTestCronjob(boxId, { name: "Job 1" });
    await createTestCronjob(boxId, { name: "Job 2" });
    await createTestCronjob(boxId, { name: "Job 3" });

    const result = await cronjobService.listByBox(boxId);
    const cronjobs = result._unsafeUnwrap();

    expect(cronjobs.length).toBe(3);
    for (const cj of cronjobs) {
      expect(cj.boxId).toBe(boxId);
    }
  });

  test("listByBox returns empty for no cronjobs", async () => {
    const boxId = await createTestBox("empty-list-test");

    const result = await cronjobService.listByBox(boxId);
    const cronjobs = result._unsafeUnwrap();

    expect(cronjobs.length).toBe(0);
  });

  test("getById returns cronjob", async () => {
    const boxId = await createTestBox("getbyid-test");
    const created = await createTestCronjob(boxId, { name: "Find Me" });

    const result = await cronjobService.getById(created.id);
    const cronjob = result._unsafeUnwrap();

    expect(cronjob).not.toBeNull();
    expect(cronjob?.id).toBe(created.id);
    expect(cronjob?.name).toBe("Find Me");
  });

  test("getById returns null for non-existent", async () => {
    const fakeId = typeIdGenerator("boxCronjob");

    const result = await cronjobService.getById(fakeId);
    const cronjob = result._unsafeUnwrap();

    expect(cronjob).toBeNull();
  });

  test("createExecution creates pending record", async () => {
    const boxId = await createTestBox("execution-test");
    const cronjob = await createTestCronjob(boxId);

    const result = await cronjobService.createExecution(cronjob.id);
    const execution = result._unsafeUnwrap();

    expect(execution.cronjobId).toBe(cronjob.id);
    expect(execution.status).toBe("pending");
    expect(execution.startedAt).toBeDefined();
  });

  test("updateExecution changes status", async () => {
    const boxId = await createTestBox("update-exec-test");
    const cronjob = await createTestCronjob(boxId);

    const createResult = await cronjobService.createExecution(cronjob.id);
    const execution = createResult._unsafeUnwrap();

    const now = new Date();
    await cronjobService.updateExecution(execution.id, {
      status: "completed",
      completedAt: now,
      durationMs: 1234,
    });

    const listResult = await cronjobService.listExecutions(cronjob.id);
    const executions = listResult._unsafeUnwrap();
    const updated = executions.find((e) => e.id === execution.id);

    expect(updated?.status).toBe("completed");
    expect(updated?.durationMs).toBe(1234);
  });

  test("listExecutions returns history ordered by startedAt", async () => {
    const boxId = await createTestBox("exec-history-test");
    const cronjob = await createTestCronjob(boxId);

    // Create multiple executions
    await cronjobService.createExecution(cronjob.id);
    await new Promise((r) => setTimeout(r, 10)); // small delay
    await cronjobService.createExecution(cronjob.id);
    await new Promise((r) => setTimeout(r, 10));
    await cronjobService.createExecution(cronjob.id);

    const result = await cronjobService.listExecutions(cronjob.id);
    const executions = result._unsafeUnwrap();

    expect(executions.length).toBe(3);
    // Should be ordered desc by startedAt (most recent first)
    for (let i = 0; i < executions.length - 1; i++) {
      expect(executions[i]!.startedAt.getTime()).toBeGreaterThanOrEqual(
        executions[i + 1]!.startedAt.getTime()
      );
    }
  });

  test("listExecutions respects limit", async () => {
    const boxId = await createTestBox("exec-limit-test");
    const cronjob = await createTestCronjob(boxId);

    for (let i = 0; i < 5; i++) {
      await cronjobService.createExecution(cronjob.id);
    }

    const result = await cronjobService.listExecutions(cronjob.id, 3);
    const executions = result._unsafeUnwrap();

    expect(executions.length).toBe(3);
  });

  test("updateLastRunAt updates timestamps", async () => {
    const boxId = await createTestBox("lastrun-test");
    const cronjob = await createTestCronjob(boxId);
    expect(cronjob.lastRunAt).toBeNull();

    await cronjobService.updateLastRunAt(cronjob.id);

    const result = await cronjobService.getById(cronjob.id);
    const updated = result._unsafeUnwrap();

    expect(updated?.lastRunAt).not.toBeNull();
    expect(updated?.nextRunAt).toBeDefined();
  });

  test("getBoxForCronjob returns box info", async () => {
    const boxId = await createTestBox("getbox-test");
    const cronjob = await createTestCronjob(boxId);

    const result = await cronjobService.getBoxForCronjob(cronjob.id);
    const boxInfo = result._unsafeUnwrap();

    expect(boxInfo.boxId).toBe(boxId);
  });

  test("getBoxForCronjob returns NOT_FOUND for missing cronjob", async () => {
    const fakeId = typeIdGenerator("boxCronjob");
    const result = await cronjobService.getBoxForCronjob(fakeId);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("NOT_FOUND");
  });
});
