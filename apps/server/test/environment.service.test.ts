import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { createEnvironmentService } from "@vps-claude/api/services/environment.service";

describe("EnvironmentService", () => {
  let testSetup: TestSetup;
  let environmentService: ReturnType<typeof createEnvironmentService>;

  beforeAll(async () => {
    testSetup = await createTestSetup();
    environmentService = createEnvironmentService({ deps: { db: testSetup.db } });
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
    it("should create an environment with pending status", async () => {
      const userId = testSetup.users.authenticated.id;
      const result = await environmentService.create(userId, {
        name: "Test Workspace",
        password: "password123",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.name).toBe("Test Workspace");
        expect(result.value.status).toBe("pending");
        expect(result.value.subdomain).toMatch(/^test-workspace-[a-z0-9]{4}$/);
      }
    });

    it("should reject duplicate environment names", async () => {
      const userId = testSetup.users.authenticated.id;

      await environmentService.create(userId, {
        name: "Duplicate Name",
        password: "password123",
      });

      const result = await environmentService.create(userId, {
        name: "Duplicate Name",
        password: "password456",
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("ALREADY_EXISTS");
      }
    });
  });

  describe("listByUser", () => {
    it("should return empty list for user with no environments", async () => {
      const userId = testSetup.users.authenticated.id;
      const environments = await environmentService.listByUser(userId);

      expect(environments).toEqual([]);
    });

    it("should return all non-deleted environments for user", async () => {
      const userId = testSetup.users.authenticated.id;

      await environmentService.create(userId, {
        name: "Env 1",
        password: "password123",
      });
      await environmentService.create(userId, {
        name: "Env 2",
        password: "password123",
      });

      const environments = await environmentService.listByUser(userId);

      expect(environments).toHaveLength(2);
      expect(environments.map((e) => e.name)).toContain("Env 1");
      expect(environments.map((e) => e.name)).toContain("Env 2");
    });

    it("should not return deleted environments", async () => {
      const userId = testSetup.users.authenticated.id;

      const result = await environmentService.create(userId, {
        name: "To Delete",
        password: "password123",
      });

      if (result.isOk()) {
        await environmentService.delete(result.value.id, userId);
      }

      const environments = await environmentService.listByUser(userId);
      expect(environments).toHaveLength(0);
    });
  });

  describe("getById", () => {
    it("should return environment by id", async () => {
      const userId = testSetup.users.authenticated.id;

      const createResult = await environmentService.create(userId, {
        name: "Find Me",
        password: "password123",
      });

      expect(createResult.isOk()).toBe(true);
      if (createResult.isOk()) {
        const env = await environmentService.getById(createResult.value.id);
        expect(env).toBeDefined();
        expect(env?.name).toBe("Find Me");
      }
    });

    it("should return undefined for non-existent id", async () => {
      const env = await environmentService.getById("non-existent-id");
      expect(env).toBeUndefined();
    });
  });

  describe("updateStatus", () => {
    it("should update environment status", async () => {
      const userId = testSetup.users.authenticated.id;

      const createResult = await environmentService.create(userId, {
        name: "Status Test",
        password: "password123",
      });

      expect(createResult.isOk()).toBe(true);
      if (createResult.isOk()) {
        await environmentService.updateStatus(createResult.value.id, "running");
        const env = await environmentService.getById(createResult.value.id);
        expect(env?.status).toBe("running");
      }
    });

    it("should update error message when status is error", async () => {
      const userId = testSetup.users.authenticated.id;

      const createResult = await environmentService.create(userId, {
        name: "Error Test",
        password: "password123",
      });

      expect(createResult.isOk()).toBe(true);
      if (createResult.isOk()) {
        await environmentService.updateStatus(createResult.value.id, "error", "Deployment failed");
        const env = await environmentService.getById(createResult.value.id);
        expect(env?.status).toBe("error");
        expect(env?.errorMessage).toBe("Deployment failed");
      }
    });
  });
});
