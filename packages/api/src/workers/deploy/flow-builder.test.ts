import { SETUP_STEP_KEYS } from "@vps-claude/sprites";
import { describe, expect, it } from "bun:test";

import { buildDeployFlow, type DeployFlowParams } from "./flow-builder";

const baseParams: DeployFlowParams = {
  boxId: "box_test123",
  deploymentAttempt: 1,
  spriteName: "test-sprite",
  spriteUrl: "https://test.sprites.dev",
  envVars: { TEST: "value" },
  boxAgentBinaryUrl: "https://example.com/box-agent",
  skillsWithSources: [],
  completedStepKeys: [],
  completedSkillIds: [],
};

function countSetupStepsInChain(
  flow: ReturnType<typeof buildDeployFlow>
): number {
  // Navigate: finalize -> health-check -> enable-access -> setup chain
  const healthCheck = flow.children?.[0];
  const enableAccess = healthCheck?.children?.[0];
  const setupChain = enableAccess?.children?.find((c) =>
    c.name.startsWith("SETUP_")
  );

  if (!setupChain) return 0;

  let count = 1;
  let current: typeof setupChain | undefined = setupChain;
  while (current?.children?.length) {
    count++;
    current = current.children[0];
  }
  return count;
}

function getSetupStepKeysInChain(
  flow: ReturnType<typeof buildDeployFlow>
): string[] {
  const healthCheck = flow.children?.[0];
  const enableAccess = healthCheck?.children?.[0];
  const setupChain = enableAccess?.children?.find((c) =>
    c.name.startsWith("SETUP_")
  );

  if (!setupChain) return [];

  const keys: string[] = [];
  let current: typeof setupChain | undefined = setupChain;
  while (current) {
    // Extract step key from job name (format: SETUP_XXX-boxId)
    const stepKey = current.name.split("-")[0] ?? "";
    keys.push(stepKey);
    current = current.children?.[0];
  }
  return keys;
}

function getSkillsInGate(flow: ReturnType<typeof buildDeployFlow>): string[] {
  const healthCheck = flow.children?.[0];
  const enableAccess = healthCheck?.children?.[0];
  const skillsGate = enableAccess?.children?.find((c) =>
    c.name.startsWith("skills-gate-")
  );

  if (!skillsGate?.children) return [];

  return skillsGate.children.map((c) => {
    // Extract skill ID from job name (format: skill-{skillId}-boxId)
    const parts = c.name.split("-");
    return parts.slice(1, -1).join("-"); // Handle skill IDs with dashes
  });
}

describe("buildDeployFlow", () => {
  describe("with no completed steps", () => {
    it("builds full flow with all setup steps", () => {
      const flow = buildDeployFlow(baseParams);

      expect(flow.name).toBe(`finalize-${baseParams.boxId}`);
      expect(countSetupStepsInChain(flow)).toBe(SETUP_STEP_KEYS.length);
    });

    it("includes all setup step keys in correct order", () => {
      const flow = buildDeployFlow(baseParams);
      const stepKeys = getSetupStepKeysInChain(flow);

      // Keys should be in reverse order (last step is root, first is deepest)
      const expectedReverse = [...SETUP_STEP_KEYS].reverse();
      expect(stepKeys).toEqual(expectedReverse);
    });
  });

  describe("with completed setup steps", () => {
    it("skips completed setup steps", () => {
      const completedStepKeys = [
        "SETUP_DOWNLOAD_AGENT",
        "SETUP_CREATE_DIRS",
        "SETUP_ENV_VARS",
      ];

      const flow = buildDeployFlow({
        ...baseParams,
        completedStepKeys,
      });

      const stepKeys = getSetupStepKeysInChain(flow);
      const expectedRemaining = SETUP_STEP_KEYS.filter(
        (k) => !completedStepKeys.includes(k)
      );

      expect(stepKeys.length).toBe(expectedRemaining.length);
      expect(stepKeys).not.toContain("SETUP_DOWNLOAD_AGENT");
      expect(stepKeys).not.toContain("SETUP_CREATE_DIRS");
      expect(stepKeys).not.toContain("SETUP_ENV_VARS");
    });

    it("handles all setup steps completed", () => {
      const flow = buildDeployFlow({
        ...baseParams,
        completedStepKeys: [...SETUP_STEP_KEYS],
      });

      // Flow should still exist (finalize -> health-check -> enable-access)
      expect(flow.name).toBe(`finalize-${baseParams.boxId}`);

      // But no setup steps
      expect(countSetupStepsInChain(flow)).toBe(0);
    });

    it("preserves step order when skipping middle steps", () => {
      // Skip steps 3 and 5
      const completedStepKeys = [
        "SETUP_ENV_VARS", // step 3
        "SETUP_BOX_AGENT_SERVICE", // step 5
      ];

      const flow = buildDeployFlow({
        ...baseParams,
        completedStepKeys,
      });

      const stepKeys = getSetupStepKeysInChain(flow);

      // Should have 8 steps (10 - 2 completed)
      expect(stepKeys.length).toBe(8);
      expect(stepKeys).not.toContain("SETUP_ENV_VARS");
      expect(stepKeys).not.toContain("SETUP_BOX_AGENT_SERVICE");
    });
  });

  describe("with skills", () => {
    it("includes skills gate when skills provided", () => {
      const flow = buildDeployFlow({
        ...baseParams,
        skillsWithSources: [
          {
            skillId: "remotion-best-practices",
            topSource: "remotion-dev/skills",
          },
          { skillId: "vercel-ai", topSource: "vercel-labs/skills" },
        ],
      });

      const skills = getSkillsInGate(flow);
      expect(skills).toContain("remotion-best-practices");
      expect(skills).toContain("vercel-ai");
    });

    it("skips completed skills", () => {
      const flow = buildDeployFlow({
        ...baseParams,
        skillsWithSources: [
          { skillId: "skill-a", topSource: "a/repo" },
          { skillId: "skill-b", topSource: "b/repo" },
          { skillId: "skill-c", topSource: "c/repo" },
        ],
        completedSkillIds: ["skill-a", "skill-c"],
      });

      const skills = getSkillsInGate(flow);
      expect(skills).toEqual(["skill-b"]);
    });

    it("omits skills gate when all skills completed", () => {
      const flow = buildDeployFlow({
        ...baseParams,
        skillsWithSources: [
          { skillId: "skill-a", topSource: "a/repo" },
          { skillId: "skill-b", topSource: "b/repo" },
        ],
        completedSkillIds: ["skill-a", "skill-b"],
      });

      const skills = getSkillsInGate(flow);
      expect(skills).toEqual([]);
    });
  });

  describe("full resume scenario", () => {
    it("resumes from middle of deployment", () => {
      // Scenario: Steps 1-4 completed, step 5 failed, skills not started
      const completedStepKeys = [
        "SETUP_DOWNLOAD_AGENT",
        "SETUP_CREATE_DIRS",
        "SETUP_ENV_VARS",
        "SETUP_CREATE_ENV_FILE",
      ];

      const flow = buildDeployFlow({
        ...baseParams,
        completedStepKeys,
        skillsWithSources: [{ skillId: "some-skill", topSource: "owner/repo" }],
        completedSkillIds: [],
      });

      // Should have 6 remaining setup steps (10 - 4)
      expect(countSetupStepsInChain(flow)).toBe(6);

      // First step in chain should be step 5
      const stepKeys = getSetupStepKeysInChain(flow);
      expect(stepKeys[stepKeys.length - 1]).toBe("SETUP_BOX_AGENT_SERVICE");

      // Skill should still be included
      const skills = getSkillsInGate(flow);
      expect(skills).toEqual(["some-skill"]);
    });

    it("handles partial skill completion", () => {
      // All setup done, 1 of 2 skills done
      const flow = buildDeployFlow({
        ...baseParams,
        completedStepKeys: [...SETUP_STEP_KEYS],
        skillsWithSources: [
          { skillId: "done-skill", topSource: "done/repo" },
          { skillId: "pending-skill", topSource: "pending/repo" },
        ],
        completedSkillIds: ["done-skill"],
      });

      expect(countSetupStepsInChain(flow)).toBe(0);
      expect(getSkillsInGate(flow)).toEqual(["pending-skill"]);
    });

    it("handles everything completed except finalize steps", () => {
      const flow = buildDeployFlow({
        ...baseParams,
        completedStepKeys: [...SETUP_STEP_KEYS],
        skillsWithSources: [{ skillId: "skill-a", topSource: "a/repo" }],
        completedSkillIds: ["skill-a"],
      });

      // Flow should still run enable-access -> health-check -> finalize
      expect(flow.name).toContain("finalize");
      expect(flow.children?.[0]?.name).toContain("health-check");
      expect(flow.children?.[0]?.children?.[0]?.name).toContain(
        "enable-access"
      );

      // But no setup steps or skills
      expect(countSetupStepsInChain(flow)).toBe(0);
      expect(getSkillsInGate(flow)).toEqual([]);
    });
  });
});
