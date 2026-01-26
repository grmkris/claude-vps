/**
 * Types for skills.sh community skill catalog
 * @see https://skills.sh
 */

export interface SkillsShSkill {
  id: string;
  name: string;
  description?: string;
  installs: number;
  /** GitHub repo path like "vercel-labs/agent-skills" */
  topSource: string;
}

export interface SkillsShResponse {
  skills: SkillsShSkill[];
  hasMore: boolean;
}

/**
 * Construct GitHub raw URL for SKILL.md
 * @param topSource - GitHub repo path like "vercel-labs/agent-skills"
 * @param skillId - Skill ID like "vercel-react-best-practices"
 * @returns Raw GitHub URL for SKILL.md
 */
export function getSkillMdUrl(topSource: string, skillId: string): string {
  return `https://raw.githubusercontent.com/${topSource}/main/skills/${skillId}/SKILL.md`;
}
