import { createAuthClient } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";

import type { Auth } from "./auth-config";

export const createAuthServerClient = (props: { baseURL: string }) =>
  createAuthClient({
    baseURL: props.baseURL,
    plugins: [inferAdditionalFields<Auth>()],
  });
