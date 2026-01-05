import { DOCKERFILE_TEMPLATE } from "./dockerfile-template";

export interface SkillPackages {
  aptPackages: string[];
  npmPackages: string[];
  pipPackages: string[];
}

export interface SkillMdFile {
  slug: string;
  content: string;
}

export interface DockerfileOptions {
  claudeMdContent: string;
  skillPackages?: SkillPackages;
  skillMdFiles?: SkillMdFile[];
  additionalAptPackages?: string[];
  additionalNpmPackages?: string[];
}

function escapeForHeredoc(content: string): string {
  return content.replace(/SKILL_EOF/g, "SKILL_E0F");
}

export function buildDockerfile(options: DockerfileOptions): string {
  const packages = options.skillPackages ?? {
    aptPackages: [],
    npmPackages: [],
    pipPackages: [],
  };

  const allAptPackages = [
    ...packages.aptPackages,
    ...(options.additionalAptPackages ?? []),
  ];

  const allNpmPackages = [
    ...packages.npmPackages,
    ...(options.additionalNpmPackages ?? []),
  ];

  const aptInstall = allAptPackages.length
    ? `RUN apt-get update && apt-get install -y --no-install-recommends \\\n    ${allAptPackages.join(" \\\n    ")} \\\n    && apt-get clean && rm -rf /var/lib/apt/lists/*`
    : "";

  const npmInstall = allNpmPackages.length
    ? `RUN npm install -g ${allNpmPackages.join(" ")}`
    : "";

  const pipInstall = packages.pipPackages.length
    ? `RUN pip3 install --break-system-packages ${packages.pipPackages.join(" ")}`
    : "";

  const skillMdCommands = (options.skillMdFiles ?? [])
    .map(
      (s) => `RUN mkdir -p /home/coder/.claude/skills/${s.slug}
COPY --chown=coder:coder <<'SKILL_EOF' /home/coder/.claude/skills/${s.slug}/SKILL.md
${escapeForHeredoc(s.content)}
SKILL_EOF`
    )
    .join("\n\n");

  return DOCKERFILE_TEMPLATE.replace(
    "{{CLAUDE_MD_CONTENT}}",
    options.claudeMdContent
  )
    .replace("{{APT_INSTALL}}", aptInstall)
    .replace("{{NPM_INSTALL}}", npmInstall)
    .replace("{{PIP_INSTALL}}", pipInstall)
    .replace("{{SKILL_MD_FILES}}", skillMdCommands);
}
