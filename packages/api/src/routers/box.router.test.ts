import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createBoxService, type BoxService } from "../services/box.service";

describe("BoxService", () => {
  let testEnv: TestSetup;
  let boxService: BoxService;

  beforeAll(async () => {
    testEnv = await createTestSetup();
    boxService = createBoxService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
  }, 30_000);

  afterAll(async () => {
    await testEnv.close();
  });

  test("create box with deploying status", async () => {
    const result = await boxService.create(testEnv.users.authenticated.id, {
      name: "test-box-1",
    });

    const box = result._unsafeUnwrap();
    expect(box.status).toBe("deploying");
    expect(box.name).toBe("test-box-1");
    expect(box.subdomain).toBeDefined();
    expect(box.userId).toBe(testEnv.users.authenticated.id);
  });

  test("create rejects duplicate name", async () => {
    // Create first box
    await boxService.create(testEnv.users.authenticated.id, {
      name: "duplicate-name",
    });

    // Try to create second box with same name
    const result = await boxService.create(testEnv.users.authenticated.id, {
      name: "duplicate-name",
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("ALREADY_EXISTS");
  });

  test("list returns user boxes", async () => {
    // Create a box first
    await boxService.create(testEnv.users.authenticated.id, {
      name: "list-test-box",
    });

    const result = await boxService.listByUser(testEnv.users.authenticated.id);
    const boxes = result._unsafeUnwrap();

    expect(boxes.length).toBeGreaterThan(0);
    // All boxes should belong to authenticated user
    for (const box of boxes) {
      expect(box.userId).toBe(testEnv.users.authenticated.id);
    }
  });

  test("getById returns box for owner", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "getbyid-test" }
    );
    const created = createResult._unsafeUnwrap();

    const boxResult = await boxService.getById(created.id);
    const box = boxResult._unsafeUnwrap();

    expect(box).toBeDefined();
    expect(box?.id).toBe(created.id);
    expect(box?.name).toBe("getbyid-test");
  });

  test("deploy rejects non-error box", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "deploy-test" }
    );
    const box = createResult._unsafeUnwrap();

    // Box is in "deploying" status, deploy should fail
    const deployResult = await boxService.deploy(
      box.id,
      testEnv.users.authenticated.id
    );

    expect(deployResult.isErr()).toBe(true);
    const error = deployResult._unsafeUnwrapErr();
    expect(error.type).toBe("INVALID_STATUS");
  });

  test("deploy works for error status box", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "deploy-retry" }
    );
    const box = createResult._unsafeUnwrap();

    // Simulate error status
    await boxService.updateStatus(box.id, "error", "Test error");

    // Deploy should work now
    const deployResult = await boxService.deploy(
      box.id,
      testEnv.users.authenticated.id
    );

    deployResult._unsafeUnwrap();

    // Verify status changed to deploying
    const updatedResult = await boxService.getById(box.id);
    const updated = updatedResult._unsafeUnwrap();
    expect(updated?.status).toBe("deploying");
  });

  test("deploy rejects other user's box", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "other-user-box" }
    );
    const box = createResult._unsafeUnwrap();

    // Simulate error status so deploy would be allowed
    await boxService.updateStatus(box.id, "error", "Test error");

    const fakeUserId = "usr_fakeuser123";
    const deployResult = await boxService.deploy(box.id, fakeUserId);

    expect(deployResult.isErr()).toBe(true);
    const error = deployResult._unsafeUnwrapErr();
    expect(error.type).toBe("NOT_FOUND");
  });

  test("delete removes box", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "delete-test" }
    );
    const box = createResult._unsafeUnwrap();

    const deleteResult = await boxService.delete(
      box.id,
      testEnv.users.authenticated.id
    );

    deleteResult._unsafeUnwrap();

    // Verify box is deleted (getById returns null)
    const deletedResult = await boxService.getById(box.id);
    const deleted = deletedResult._unsafeUnwrap();
    expect(deleted).toBeNull();
  });

  test("list excludes deleted boxes", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "will-be-deleted" }
    );
    const box = createResult._unsafeUnwrap();

    // Delete the box
    await boxService.delete(box.id, testEnv.users.authenticated.id);

    // List should not include deleted box
    const listResult = await boxService.listByUser(
      testEnv.users.authenticated.id
    );
    const boxes = listResult._unsafeUnwrap();
    const deletedBox = boxes.find((b) => b.id === box.id);
    expect(deletedBox).toBeUndefined();
  });
});
