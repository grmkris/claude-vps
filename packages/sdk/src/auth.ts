import type { Auth } from "@vps-claude/auth";

import { createAuthClient } from "better-auth/client";
import {
  apiKeyClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";

export type AuthClient = ReturnType<typeof createAuthHelper>;

export function createAuthHelper(baseUrl: string, sessionToken?: string) {
  const headers: Record<string, string> = {
    // Origin header required for better-auth CORS validation in Node.js
    Origin: baseUrl,
  };

  if (sessionToken) {
    // Try both Cookie and Authorization header
    headers.Cookie = `better-auth.session_token=${sessionToken}`;
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  return createAuthClient({
    baseURL: baseUrl,
    plugins: [inferAdditionalFields<Auth>(), apiKeyClient()],
    fetchOptions: {
      headers,
      credentials: "include",
    },
  });
}

export type SignInResult = {
  sessionToken: string | null;
  sessionCookie: string | null; // Full cookie value with signature
  user: { id: string; email: string; name: string } | null;
  error: string | null;
};

export async function signIn(
  baseUrl: string,
  email: string,
  password: string
): Promise<SignInResult> {
  // Make direct fetch to capture Set-Cookie header (can't get it via better-auth client)
  try {
    const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        sessionToken: null,
        sessionCookie: null,
        user: null,
        error:
          (errorData as { message?: string }).message ??
          `HTTP ${response.status}`,
      };
    }

    // Extract session cookie from Set-Cookie header
    const setCookie = response.headers.get("set-cookie");
    let sessionCookie: string | null = null;
    if (setCookie) {
      const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
      if (match?.[1]) {
        sessionCookie = decodeURIComponent(match[1]);
      }
    }

    const data = await response.json();
    return {
      sessionToken: (data as { token?: string }).token ?? null,
      sessionCookie,
      user: (data as { user?: SignInResult["user"] }).user ?? null,
      error: null,
    };
  } catch (err) {
    return {
      sessionToken: null,
      sessionCookie: null,
      user: null,
      error: err instanceof Error ? err.message : "Sign in failed",
    };
  }
}

export type CreateApiKeyOptions = {
  name: string;
  permissions?: {
    box?: ("create" | "read" | "delete" | "deploy")[];
    secret?: ("read" | "create" | "delete")[];
    skill?: ("read" | "create" | "delete")[];
  };
  expiresIn?: number;
};

export type CreateApiKeyResult = {
  key: string | null;
  id: string | null;
  error: string | null;
};

export async function createApiKey(
  _auth: AuthClient,
  options: CreateApiKeyOptions & { baseUrl?: string; sessionToken?: string }
): Promise<CreateApiKeyResult> {
  // Use the server-side RPC endpoint that can set permissions
  // (better-auth client blocks permissions from being set client-side)
  if (!options.sessionToken || !options.baseUrl) {
    return {
      key: null,
      id: null,
      error: "baseUrl and sessionToken are required for API key creation",
    };
  }

  // Import createClient dynamically to avoid circular deps
  const { createClient } = await import("./client");

  try {
    // Convert nested permissions to flat string array format
    // e.g., { box: ['create', 'read'] } -> ['box:create', 'box:read']
    const flatPermissions = options.permissions
      ? Object.entries(options.permissions).flatMap(([resource, actions]) =>
          (actions ?? []).map((action) => `${resource}:${action}`)
        )
      : undefined;

    // Use ORPC client which handles the wire format correctly
    const client = createClient({
      baseUrl: options.baseUrl,
      sessionToken: options.sessionToken,
    });

    const result = await client.apiKey.create({
      name: options.name,
      permissions: flatPermissions,
      expiresIn: options.expiresIn,
    });

    return {
      key: result.key ?? null,
      id: result.id ?? null,
      error: null,
    };
  } catch (err) {
    return {
      key: null,
      id: null,
      error: err instanceof Error ? err.message : "Failed to create API key",
    };
  }
}
