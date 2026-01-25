import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { publicProcedure } from "../index";

const SkillsShSkill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  installs: z.number(),
  topSource: z.string(),
});

const SkillsShResponse = z.object({
  skills: z.array(SkillsShSkill),
  hasMore: z.boolean(),
});

export const skillRouter = {
  catalog: publicProcedure
    .route({ method: "GET", path: "/skill/catalog" })
    .output(SkillsShResponse)
    .handler(async () => {
      const res = await fetch("https://skills.sh/api/skills?limit=100");
      if (!res.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to fetch skills catalog",
        });
      }
      return res.json() as Promise<z.infer<typeof SkillsShResponse>>;
    }),
};
