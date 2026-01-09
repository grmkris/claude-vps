import { createAuthClient } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";

import type { Auth } from "./auth-config";

export const createAuthServerClient = (props: { baseUrl: string }) =>
  createAuthClient({
    baseUrl: props.baseUrl,
    plugins: [inferAdditionalFields<Auth>()],
  });
