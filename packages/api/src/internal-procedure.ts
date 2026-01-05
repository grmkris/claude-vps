import { ORPCError } from "@orpc/server";

import { o } from "./index";

// For platform services (ssh-bastion) - validates INTERNAL_API_KEY
const requireInternalApiKey = o.middleware(async ({ context, next }) => {
  const expected = `Bearer ${context.internalApiKey}`;

  if (context.authorizationHeader !== expected) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({ context });
});

// For per-box auth (box-agent calling email/send) - extracts token for handler validation
const requireBoxToken = o.middleware(async ({ context, next }) => {
  const token = context.authorizationHeader?.replace("Bearer ", "");

  if (!token) {
    throw new ORPCError("UNAUTHORIZED", { message: "Missing box token" });
  }

  return next({ context: { ...context, boxToken: token } });
});

// Platform service procedure (ssh-bastion)
export const internalProcedure = o.use(requireInternalApiKey);

// Per-box procedure (box-agent email send)
export const boxProcedure = o.use(requireBoxToken);
