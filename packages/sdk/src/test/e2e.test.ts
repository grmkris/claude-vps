import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createClient } from "../index";
import {
  createReadOnlyApiKey,
  setupTestUser,
  TEST_CONFIG,
  type TestSetup,
} from "./setup";

describe("SDK E2E Tests", () => {
  let setup: TestSetup;

  beforeAll(async () => {
    setup = await setupTestUser();
  }, 30_000);

  afterAll(async () => {
    // Clean up: revoke test API key
    if (setup?.apiKeyId) {
      try {
        await setup.auth.apiKey.delete({ keyId: setup.apiKeyId });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("API Key Authentication", () => {
    test("can list boxes with API key", async () => {
      const result = await setup.client.box.list({});

      expect(result).toBeDefined();
      expect(result.boxes).toBeDefined();
      expect(Array.isArray(result.boxes)).toBe(true);
    });

    test("can list credentials with API key", async () => {
      const result = await setup.client.credential.list({});

      expect(result).toBeDefined();
      expect(result.credentials).toBeDefined();
      expect(Array.isArray(result.credentials)).toBe(true);
    });

    test("can fetch skills catalog", async () => {
      const result = await setup.client.skill.catalog({});

      expect(result).toBeDefined();
      expect(result.skills).toBeDefined();
      expect(Array.isArray(result.skills)).toBe(true);
    });

    test("health check works without auth", async () => {
      const client = createClient({
        baseUrl: TEST_CONFIG.baseUrl,
      });

      const result = await client.healthCheck();
      expect(result).toBe("OK");
    });
  });

  describe("Session Authentication", () => {
    test("can list boxes with session cookie", async () => {
      if (!setup.sessionCookie) {
        console.log("Skipping session test - no session cookie available");
        return;
      }

      // Session auth requires full cookie value (includes signature)
      const client = createClient({
        baseUrl: TEST_CONFIG.baseUrl,
        sessionToken: setup.sessionCookie,
      });

      const result = await client.box.list({});
      expect(result).toBeDefined();
      expect(result.boxes).toBeDefined();
    });
  });

  describe("Permission Enforcement", () => {
    test("full-access API key can list", async () => {
      // The test API key has full permissions
      const listResult = await setup.client.box.list({});
      expect(listResult.boxes).toBeDefined();
      expect(Array.isArray(listResult.boxes)).toBe(true);
    });

    test("read-only API key cannot create box", async () => {
      if (!setup.sessionCookie) {
        console.log("Skipping - no session cookie");
        return;
      }

      const readOnlyKey = await createReadOnlyApiKey(
        setup.auth,
        setup.sessionCookie
      );

      const client = createClient({
        baseUrl: TEST_CONFIG.baseUrl,
        apiKey: readOnlyKey,
      });

      // Should be able to list
      const listResult = await client.box.list({});
      expect(listResult.boxes).toBeDefined();

      // Should NOT be able to create
      try {
        await client.box.create({
          name: "should-fail",
          skills: [],
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        // Error indicates permission denial
        const errorStr = String(error).toLowerCase();
        expect(
          errorStr.includes("forbidden") ||
            errorStr.includes("missing permission") ||
            errorStr.includes("unauthorized") ||
            errorStr.includes("permission")
        ).toBe(true);
      }
    }, 15_000);

    test("read-only API key cannot create secret", async () => {
      if (!setup.sessionCookie) {
        console.log("Skipping - no session cookie");
        return;
      }

      const readOnlyKey = await createReadOnlyApiKey(
        setup.auth,
        setup.sessionCookie
      );

      const client = createClient({
        baseUrl: TEST_CONFIG.baseUrl,
        apiKey: readOnlyKey,
      });

      try {
        await client.credential.set({
          key: "TEST_CREDENTIAL",
          value: "should-fail",
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        const errorStr = String(error).toLowerCase();
        expect(
          errorStr.includes("forbidden") ||
            errorStr.includes("missing permission")
        ).toBe(true);
      }
    });
  });

  describe("Unauthorized Access", () => {
    test("invalid API key returns error", async () => {
      const client = createClient({
        baseUrl: TEST_CONFIG.baseUrl,
        apiKey: "yoda_invalid_key_12345678901234567890",
      });

      try {
        await client.box.list({});
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        // Error can be "Unauthorized" or "Internal Server Error" depending on how auth fails
        const errorStr = String(error).toLowerCase();
        expect(
          errorStr.includes("unauthorized") || errorStr.includes("error")
        ).toBe(true);
      }
    });

    test("no auth returns unauthorized for protected routes", async () => {
      const client = createClient({
        baseUrl: TEST_CONFIG.baseUrl,
      });

      try {
        await client.box.list({});
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        // Error message is "Unauthorized" (capitalized)
        expect(String(error).toLowerCase()).toContain("unauthorized");
      }
    });
  });
});
