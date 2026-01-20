import {
  apiKeyClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { Auth } from "./auth-config";

export const createAuthWebClient = (props: { baseURL: string }) =>
  createAuthClient({
    baseURL: props.baseURL,
    plugins: [inferAdditionalFields<Auth>(), apiKeyClient()],
  });
