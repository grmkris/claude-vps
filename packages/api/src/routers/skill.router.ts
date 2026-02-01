import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { publicProcedure } from "../index";

const SkillsShSkill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
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
    .input(
      z.object({
        search: z.string().optional(),
        offset: z.coerce.number().min(0).optional(),
        limit: z.coerce.number().min(1).max(100).optional(),
      })
    )
    .output(SkillsShResponse)
    .handler(async ({ input }) => {
      const params = new URLSearchParams();
      params.set("limit", String(input.limit ?? 30));
      if (input.search) params.set("search", input.search);
      if (input.offset) params.set("offset", String(input.offset));

      const res = await fetch(`https://skills.sh/api/skills?${params}`);
      if (!res.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to fetch skills catalog",
        });
      }
      return res.json() as Promise<z.infer<typeof SkillsShResponse>>;
    }),
};
