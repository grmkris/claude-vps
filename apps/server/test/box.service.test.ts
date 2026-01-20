import { createBoxService } from "@vps-claude/api/services/box.service";
import { typeIdGenerator } from "@vps-claude/shared";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";

describe("BoxService", () => {
  let testSetup: TestSetup;
  let boxService: ReturnType<typeof createBoxService>;

  beforeAll(async () => {
    testSetup = await createTestSetup();
    boxService = createBoxService({
      deps: { db: testSetup.db, queueClient: testSetup.deps.queue },
    });
  });

  afterAll(async () => {
    await testSetup.close();
  });

  beforeEach(async () => {
    await testSetup.cleanup();
    const schema = await import("@vps-claude/db");
    await testSetup.db.insert(schema.user).values({
      id: testSetup.users.authenticated.id,
      email: testSetup.users.authenticated.email,
      name: testSetup.users.authenticated.name,
      emailVerified: true,
    });
  });

  describe("create", () => {
    it("should create a box with pending status", async () => {
      const userId = testSetup.users.authenticated.id;
      const result = await boxService.create(userId, {
        name: "Test Workspace",
        password: "password123",
      });

      const box = result._unsafeUnwrap();
      expect(box.name).toBe("Test Workspace");
      expect(box.status).toBe("pending");
      expect(box.subdomain).toMatch(/^test-workspace-[a-z0-9]{4}$/);
    });

    it("should reject duplicate box names", async () => {
      const userId = testSetup.users.authenticated.id;

      await boxService.create(userId, {
        name: "Duplicate Name",
        password: "password123",
      });

      const result = await boxService.create(userId, {
        name: "Duplicate Name",
        password: "password456",
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.type).toBe("ALREADY_EXISTS");
    });
  });

  describe("listByUser", () => {
    it("should return empty list for user with no boxes", async () => {
      const userId = testSetup.users.authenticated.id;
      const result = await boxService.listByUser(userId);

      const boxes = result._unsafeUnwrap();
      expect(boxes).toEqual([]);
    });

    it("should return all non-deleted boxes for user", async () => {
      const userId = testSetup.users.authenticated.id;

      await boxService.create(userId, {
        name: "Box 1",
        password: "password123",
      });
      await boxService.create(userId, {
        name: "Box 2",
        password: "password123",
      });

      const result = await boxService.listByUser(userId);

      const boxes = result._unsafeUnwrap();
      expect(boxes).toHaveLength(2);
      expect(boxes.map((b) => b.name)).toContain("Box 1");
      expect(boxes.map((b) => b.name)).toContain("Box 2");
    });

    it("should not return deleted boxes", async () => {
      const userId = testSetup.users.authenticated.id;

      const createResult = await boxService.create(userId, {
        name: "To Delete",
        password: "password123",
      });

      const created = createResult._unsafeUnwrap();
      await boxService.delete(created.id, userId);

      const listResult = await boxService.listByUser(userId);
      const boxes = listResult._unsafeUnwrap();
      expect(boxes).toHaveLength(0);
    });
  });

  describe("getById", () => {
    it("should return box by id", async () => {
      const userId = testSetup.users.authenticated.id;

      const createResult = await boxService.create(userId, {
        name: "Find Me",
        password: "password123",
      });

      const created = createResult._unsafeUnwrap();
      const boxResult = await boxService.getById(created.id);
      const box = boxResult._unsafeUnwrap();
      expect(box).toBeDefined();
      expect(box?.name).toBe("Find Me");
    });

    it("should return null for non-existent id", async () => {
      const result = await boxService.getById(typeIdGenerator("box"));
      const box = result._unsafeUnwrap();
      expect(box).toBeNull();
    });
  });

  describe("updateStatus", () => {
    it("should update box status", async () => {
      const userId = testSetup.users.authenticated.id;

      const createResult = await boxService.create(userId, {
        name: "Status Test",
        password: "password123",
      });

      const created = createResult._unsafeUnwrap();
      await boxService.updateStatus(created.id, "running");
      const boxResult = await boxService.getById(created.id);
      const box = boxResult._unsafeUnwrap();
      expect(box?.status).toBe("running");
    });

    it("should update error message when status is error", async () => {
      const userId = testSetup.users.authenticated.id;

      const createResult = await boxService.create(userId, {
        name: "Error Test",
        password: "password123",
      });

      const created = createResult._unsafeUnwrap();
      await boxService.updateStatus(created.id, "error", "Deployment failed");
      const boxResult = await boxService.getById(created.id);
      const box = boxResult._unsafeUnwrap();
      expect(box?.status).toBe("error");
      expect(box?.errorMessage).toBe("Deployment failed");
    });
  });
});
