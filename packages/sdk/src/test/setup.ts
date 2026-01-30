import {
  createApiKey,
  createAuthHelper,
  createClient,
  signIn,
  type AppRouterClient,
} from "../index";

export const TEST_CONFIG = {
  baseUrl: process.env.API_URL || "http://localhost:33000",
  testEmail: process.env.TEST_EMAIL || "sdk-test@example.com",
  testPassword: process.env.TEST_PASSWORD || "testpassword123",
  testName: "SDK Test User",
};

export type TestSetup = {
  auth: ReturnType<typeof createAuthHelper>;
  apiKey: string;
  apiKeyId: string;
  client: AppRouterClient;
  sessionToken: string | null;
  sessionCookie: string | null; // Full cookie with signature for session auth
};

export async function setupTestUser(): Promise<TestSetup> {
  const auth = createAuthHelper(TEST_CONFIG.baseUrl);

  // Try to sign in first (using direct fetch to get session cookie)
  let signInResult = await signIn(
    TEST_CONFIG.baseUrl,
    TEST_CONFIG.testEmail,
    TEST_CONFIG.testPassword
  );

  // If sign in fails, try to sign up
  if (signInResult.error) {
    const signUpResult = await auth.signUp.email({
      email: TEST_CONFIG.testEmail,
      password: TEST_CONFIG.testPassword,
      name: TEST_CONFIG.testName,
    });

    if (signUpResult.error) {
      throw new Error(`Failed to sign up: ${signUpResult.error.message}`);
    }

    // Sign in after sign up
    signInResult = await signIn(
      TEST_CONFIG.baseUrl,
      TEST_CONFIG.testEmail,
      TEST_CONFIG.testPassword
    );

    if (signInResult.error) {
      throw new Error(`Failed to sign in: ${signInResult.error}`);
    }
  }

  const sessionCookie = signInResult.sessionCookie;
  const sessionToken = signInResult.sessionToken;

  if (!sessionCookie) {
    throw new Error("No session cookie returned from sign in");
  }

  // Create authenticated auth helper with session cookie
  const authenticatedAuth = createAuthHelper(
    TEST_CONFIG.baseUrl,
    sessionCookie
  );

  // Create API key with full permissions via server-side RPC endpoint
  const apiKeyResult = await createApiKey(authenticatedAuth, {
    name: `e2e-test-${Date.now()}`,
    permissions: {
      box: ["create", "read", "delete", "deploy"],
      secret: ["read", "create", "delete"],
      skill: ["read", "create", "delete"],
    },
    baseUrl: TEST_CONFIG.baseUrl,
    sessionToken: sessionCookie,
  });

  if (apiKeyResult.error || !apiKeyResult.key) {
    throw new Error(`Failed to create API key: ${apiKeyResult.error}`);
  }

  // Create client with API key
  const client = createClient({
    baseUrl: TEST_CONFIG.baseUrl,
    apiKey: apiKeyResult.key,
  });

  return {
    auth: authenticatedAuth,
    apiKey: apiKeyResult.key,
    apiKeyId: apiKeyResult.id!,
    client,
    sessionToken,
    sessionCookie,
  };
}

export async function createReadOnlyApiKey(
  auth: ReturnType<typeof createAuthHelper>,
  sessionCookie: string
): Promise<string> {
  const result = await createApiKey(auth, {
    name: `e2e-readonly-${Date.now()}`,
    permissions: {
      box: ["read"],
      secret: ["read"],
      skill: ["read"],
    },
    baseUrl: TEST_CONFIG.baseUrl,
    sessionToken: sessionCookie,
  });

  if (result.error || !result.key) {
    throw new Error(`Failed to create read-only API key: ${result.error}`);
  }

  return result.key;
}
