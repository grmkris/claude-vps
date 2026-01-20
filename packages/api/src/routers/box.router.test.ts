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
  });

  afterAll(async () => {
    await testEnv.close();
  });

  test("create box with pending status", async () => {
    const result = await boxService.create(testEnv.users.authenticated.id, {
      name: "test-box-1",
      password: "password123",
    });

    const box = result._unsafeUnwrap();
    expect(box.status).toBe("pending");
    expect(box.name).toBe("test-box-1");
    expect(box.subdomain).toBeDefined();
    expect(box.userId).toBe(testEnv.users.authenticated.id);
  });

  test("create rejects duplicate name", async () => {
    // Create first box
    await boxService.create(testEnv.users.authenticated.id, {
      name: "duplicate-name",
      password: "password123",
    });

    // Try to create second box with same name
    const result = await boxService.create(testEnv.users.authenticated.id, {
      name: "duplicate-name",
      password: "password456",
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("ALREADY_EXISTS");
  });

  test("list returns user boxes", async () => {
    // Create a box first
    await boxService.create(testEnv.users.authenticated.id, {
      name: "list-test-box",
      password: "password123",
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
      { name: "getbyid-test", password: "password123" }
    );
    const created = createResult._unsafeUnwrap();

    const boxResult = await boxService.getById(created.id);
    const box = boxResult._unsafeUnwrap();

    expect(box).toBeDefined();
    expect(box?.id).toBe(created.id);
    expect(box?.name).toBe("getbyid-test");
  });

  test("deploy queues job and updates status", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "deploy-test", password: "password123" }
    );
    const box = createResult._unsafeUnwrap();

    const deployResult = await boxService.deploy(
      box.id,
      testEnv.users.authenticated.id,
      "password123"
    );

    deployResult._unsafeUnwrap();

    // Verify status changed to deploying
    const updatedResult = await boxService.getById(box.id);
    const updated = updatedResult._unsafeUnwrap();
    expect(updated?.status).toBe("deploying");
  });

  test("deploy rejects non-pending box", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "deploy-twice", password: "password123" }
    );
    const box = createResult._unsafeUnwrap();

    // First deploy
    await boxService.deploy(
      box.id,
      testEnv.users.authenticated.id,
      "password123"
    );

    // Try to deploy again - should fail
    const secondDeploy = await boxService.deploy(
      box.id,
      testEnv.users.authenticated.id,
      "password123"
    );

    expect(secondDeploy.isErr()).toBe(true);
    const error = secondDeploy._unsafeUnwrapErr();
    expect(error.type).toBe("INVALID_STATUS");
  });

  test("deploy rejects other user's box", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "other-user-box", password: "password123" }
    );
    const box = createResult._unsafeUnwrap();

    const fakeUserId = "usr_fakeuser123";
    const deployResult = await boxService.deploy(
      box.id,
      fakeUserId,
      "password123"
    );

    expect(deployResult.isErr()).toBe(true);
    const error = deployResult._unsafeUnwrapErr();
    expect(error.type).toBe("NOT_FOUND");
  });

  test("delete marks box as deleted", async () => {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "delete-test", password: "password123" }
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
      { name: "will-be-deleted", password: "password123" }
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
