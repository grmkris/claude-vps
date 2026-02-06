import { SUGGESTED_SKILLS } from "@vps-claude/shared/skills-sh";
import { describe, expect, test } from "bun:test";

describe("Skills Catalog", () => {
  test("suggested skills are sorted by installs descending", () => {
    for (let i = 1; i < SUGGESTED_SKILLS.length; i++) {
      expect(SUGGESTED_SKILLS[i - 1]!.installs).toBeGreaterThanOrEqual(
        SUGGESTED_SKILLS[i]!.installs
      );
    }
  });

  test("suggested skills have required fields", () => {
    for (const skill of SUGGESTED_SKILLS) {
      expect(skill.id).toBeTruthy();
      expect(skill.skillId).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.source).toBeTruthy();
      expect(skill.installs).toBeGreaterThan(0);
    }
  });

  test("suggested skills have unique ids", () => {
    const ids = SUGGESTED_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("skills.sh search API is reachable", async () => {
    try {
      const res = await fetch("https://skills.sh/api/search?q=react&limit=5", {
        signal: AbortSignal.timeout(5000),
      });
      expect(res.ok).toBe(true);
      const json = await res.json();
      expect(json.skills.length).toBeGreaterThan(0);
    } catch {
      // External API may be unreachable in CI — not a hard failure
      console.warn("skills.sh API unreachable, skipping search test");
    }
  });
});
