import { describe, expect, test } from "bun:test";
import { z } from "zod";

const SKILLS_SH_URL = "https://skills.sh/api/skills";

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

describe("Skills.sh API", () => {
  test("parses real skills.sh API response", async () => {
    const res = await fetch(`${SKILLS_SH_URL}?limit=30`);
    expect(res.ok).toBe(true);

    const json = await res.json();
    const result = SkillsShResponse.safeParse(json);

    if (!result.success) {
      console.error(
        "Parse errors:",
        JSON.stringify(result.error.issues, null, 2)
      );
    }
    expect(result.success).toBe(true);
    expect(result.data?.skills.length).toBeGreaterThan(0);
  });

  test("search param is accepted and returns results", async () => {
    const res = await fetch(`${SKILLS_SH_URL}?limit=30&search=react`);
    expect(res.ok).toBe(true);

    const json = await res.json();
    const result = SkillsShResponse.safeParse(json);
    expect(result.success).toBe(true);

    // Search should return results (API handles search logic internally)
    const skills = result.data?.skills ?? [];
    expect(skills.length).toBeGreaterThan(0);
  });

  test("offset param paginates results", async () => {
    // Get first page
    const res1 = await fetch(`${SKILLS_SH_URL}?limit=10`);
    const page1 = SkillsShResponse.parse(await res1.json());

    // Get second page
    const res2 = await fetch(`${SKILLS_SH_URL}?limit=10&offset=10`);
    const page2 = SkillsShResponse.parse(await res2.json());

    // Pages should have different skills
    const page1Ids = new Set(page1.skills.map((s) => s.id));
    const page2Ids = new Set(page2.skills.map((s) => s.id));

    // No overlap between pages
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
  });

  test("hasMore indicates more results available", async () => {
    // Small limit should have more
    const res1 = await fetch(`${SKILLS_SH_URL}?limit=5`);
    const small = SkillsShResponse.parse(await res1.json());
    expect(small.hasMore).toBe(true);

    // Large limit may not have more
    const res2 = await fetch(`${SKILLS_SH_URL}?limit=100`);
    const large = SkillsShResponse.parse(await res2.json());
    // Just verify it parses - hasMore depends on total count
    expect(typeof large.hasMore).toBe("boolean");
  });
});
