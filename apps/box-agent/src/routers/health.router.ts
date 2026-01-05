import { z } from "zod";

import { publicProcedure } from "../procedures";

export const healthRouter = {
  root: publicProcedure
    .route({ method: "GET", path: "/" })
    .output(z.string())
    .handler(() => "OK"),

  health: publicProcedure
    .route({ method: "GET", path: "/health" })
    .output(z.object({ status: z.string(), agent: z.string() }))
    .handler(() => ({ status: "ok", agent: "box-agent" })),
};
