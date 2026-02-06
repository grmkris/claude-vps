import { SUGGESTED_SKILLS } from "@vps-claude/shared/skills-sh";
import { z } from "zod";

import { publicProcedure } from "../index";

const SkillsShSkill = z.object({
  id: z.string(),
  skillId: z.string(),
  name: z.string(),
  installs: z.number(),
  source: z.string(),
});

const CatalogResponse = z.object({
  skills: z.array(SkillsShSkill),
  count: z.number(),
});

export const skillRouter = {
  catalog: publicProcedure
    .route({ method: "GET", path: "/skill/catalog" })
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.coerce.number().min(1).max(100).optional(),
      })
    )
    .output(CatalogResponse)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "skill.catalog", search: input.search });

      const limit = input.limit ?? 30;

      // No search → return curated suggested skills
      if (!input.search) {
        const skills = SUGGESTED_SKILLS.slice(0, limit);
        return { skills, count: SUGGESTED_SKILLS.length };
      }

      // Search → proxy to skills.sh
      try {
        const params = new URLSearchParams();
        params.set("q", input.search);
        params.set("limit", String(limit));

        const res = await fetch(`https://skills.sh/api/search?${params}`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
          throw new Error(`skills.sh returned ${res.status}`);
        }

        const data = (await res.json()) as {
          skills: z.infer<typeof SkillsShSkill>[];
          count: number;
        };
        return { skills: data.skills, count: data.count };
      } catch {
        // Fallback: filter suggested skills locally
        const query = input.search.toLowerCase();
        const filtered = SUGGESTED_SKILLS.filter(
          (s) =>
            s.name.toLowerCase().includes(query) ||
            s.source.toLowerCase().includes(query)
        );
        return { skills: filtered.slice(0, limit), count: filtered.length };
      }
    }),
};
