# Auth Client and Providers

## Auth Client Setup

Located at `apps/web/src/lib/auth-client.ts`:

```typescript
import type { Auth } from "@project/auth";
import { SERVICE_URLS } from "@project/shared/services";
import {
  anonymousClient,
  inferAdditionalFields,
  siweClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { env } from "@/env";

export const authClient = createAuthClient({
  baseURL: SERVICE_URLS[env.NEXT_PUBLIC_ENV].auth,
  plugins: [anonymousClient(), inferAdditionalFields<Auth>(), siweClient()],
});
```

## Auth Client Usage

```typescript
import { authClient } from "@/lib/auth-client";

const { data: session, isPending } = authClient.useSession();
const isAuthenticated = !!session?.user;
const isAnonymous = session?.user?.isAnonymous === true;

await authClient.signIn.anonymous();
await authClient.signOut();
```

## Provider Hierarchy

Located at `apps/web/src/components/providers.tsx`:

```
QueryClientProvider (React Query)
├── ThemeProvider (next-themes)
│   ├── ReactQueryDevtools (dev only)
│   └── Web3Provider (Wagmi/AppKit) [optional]
│       └── AuthProvider (better-auth)
│           └── {children}
└── Toaster (Sonner)
```

## Provider Implementation

```typescript
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@/utils/orpc";
import { AuthProvider } from "./auth-provider";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
      >
        <ReactQueryDevtools />
        <AuthProvider>
          {children}
        </AuthProvider>
        <Toaster richColors />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

## ORPC Client Config

```typescript
export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 } },
});

export const link = new RPCLink({
  url: `${SERVICE_URLS[env.NEXT_PUBLIC_ENV].api}/rpc`,
  fetch(_url, options) {
    return fetch(_url, { ...options, credentials: "include" });
  },
});

export const client: AppRouterClient = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
```
