/**
 * Types for skills.sh community skill catalog
 * @see https://skills.sh
 */

export interface SkillsShSkill {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  /** GitHub repo path like "vercel-labs/agent-skills" */
  source: string;
}

export interface SkillsShResponse {
  query: string;
  searchType: string;
  skills: SkillsShSkill[];
  count: number;
  duration_ms: number;
}

/**
 * Construct GitHub raw URL for SKILL.md
 * @param source - GitHub repo path like "vercel-labs/agent-skills"
 * @param skillId - Skill ID like "vercel-react-best-practices"
 * @returns Raw GitHub URL for SKILL.md
 */
export function getSkillMdUrl(source: string, skillId: string): string {
  return `https://raw.githubusercontent.com/${source}/main/skills/${skillId}/SKILL.md`;
}

/**
 * Curated catalog of popular/suggested skills.
 * Shown by default when no search query is provided.
 * Sorted by install count descending.
 */
export const SUGGESTED_SKILLS: SkillsShSkill[] = [
  {
    id: "vercel-labs/agent-skills/vercel-react-best-practices",
    skillId: "vercel-react-best-practices",
    name: "vercel-react-best-practices",
    installs: 100429,
    source: "vercel-labs/agent-skills",
  },
  {
    id: "vercel-labs/agent-skills/web-design-guidelines",
    skillId: "web-design-guidelines",
    name: "web-design-guidelines",
    installs: 75996,
    source: "vercel-labs/agent-skills",
  },
  {
    id: "remotion-dev/skills/remotion-best-practices",
    skillId: "remotion-best-practices",
    name: "remotion-best-practices",
    installs: 70529,
    source: "remotion-dev/skills",
  },
  {
    id: "anthropics/skills/frontend-design",
    skillId: "frontend-design",
    name: "frontend-design",
    installs: 45246,
    source: "anthropics/skills",
  },
  {
    id: "vercel-labs/agent-skills/vercel-composition-patterns",
    skillId: "vercel-composition-patterns",
    name: "vercel-composition-patterns",
    installs: 25296,
    source: "vercel-labs/agent-skills",
  },
  {
    id: "anthropics/skills/skill-creator",
    skillId: "skill-creator",
    name: "skill-creator",
    installs: 22349,
    source: "anthropics/skills",
  },
  {
    id: "vercel-labs/agent-skills/vercel-react-native-skills",
    skillId: "vercel-react-native-skills",
    name: "vercel-react-native-skills",
    installs: 18500,
    source: "vercel-labs/agent-skills",
  },
  {
    id: "supabase/agent-skills/supabase-postgres-best-practices",
    skillId: "supabase-postgres-best-practices",
    name: "supabase-postgres-best-practices",
    installs: 11772,
    source: "supabase/agent-skills",
  },
  {
    id: "anthropics/skills/pdf",
    skillId: "pdf",
    name: "pdf",
    installs: 9530,
    source: "anthropics/skills",
  },
  {
    id: "better-auth/skills/better-auth-best-practices",
    skillId: "better-auth-best-practices",
    name: "better-auth-best-practices",
    installs: 7982,
    source: "better-auth/skills",
  },
  {
    id: "anthropics/skills/pptx",
    skillId: "pptx",
    name: "pptx",
    installs: 7964,
    source: "anthropics/skills",
  },
  {
    id: "expo/skills/building-native-ui",
    skillId: "building-native-ui",
    name: "building-native-ui",
    installs: 7665,
    source: "expo/skills",
  },
  {
    id: "anthropics/skills/xlsx",
    skillId: "xlsx",
    name: "xlsx",
    installs: 7441,
    source: "anthropics/skills",
  },
  {
    id: "anthropics/skills/docx",
    skillId: "docx",
    name: "docx",
    installs: 7372,
    source: "anthropics/skills",
  },
  {
    id: "vercel-labs/next-skills/next-best-practices",
    skillId: "next-best-practices",
    name: "next-best-practices",
    installs: 6595,
    source: "vercel-labs/next-skills",
  },
  {
    id: "anthropics/skills/webapp-testing",
    skillId: "webapp-testing",
    name: "webapp-testing",
    installs: 6430,
    source: "anthropics/skills",
  },
  {
    id: "anthropics/skills/mcp-builder",
    skillId: "mcp-builder",
    name: "mcp-builder",
    installs: 6006,
    source: "anthropics/skills",
  },
  {
    id: "anthropics/skills/canvas-design",
    skillId: "canvas-design",
    name: "canvas-design",
    installs: 5200,
    source: "anthropics/skills",
  },
  {
    id: "expo/skills/upgrading-expo",
    skillId: "upgrading-expo",
    name: "upgrading-expo",
    installs: 5063,
    source: "expo/skills",
  },
  {
    id: "hyf0/vue-skills/vue-best-practices",
    skillId: "vue-best-practices",
    name: "vue-best-practices",
    installs: 4960,
    source: "hyf0/vue-skills",
  },
  {
    id: "expo/skills/expo-tailwind-setup",
    skillId: "expo-tailwind-setup",
    name: "expo-tailwind-setup",
    installs: 4381,
    source: "expo/skills",
  },
  {
    id: "wshobson/agents/tailwind-design-system",
    skillId: "tailwind-design-system",
    name: "tailwind-design-system",
    installs: 3662,
    source: "wshobson/agents",
  },
  {
    id: "wshobson/agents/python-performance-optimization",
    skillId: "python-performance-optimization",
    name: "python-performance-optimization",
    installs: 2449,
    source: "wshobson/agents",
  },
  {
    id: "wshobson/agents/python-testing-patterns",
    skillId: "python-testing-patterns",
    name: "python-testing-patterns",
    installs: 1928,
    source: "wshobson/agents",
  },
  {
    id: "sickn33/antigravity-awesome-skills/docker-expert",
    skillId: "docker-expert",
    name: "docker-expert",
    installs: 1286,
    source: "sickn33/antigravity-awesome-skills",
  },
];
