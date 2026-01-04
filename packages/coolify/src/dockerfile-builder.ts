import { DOCKERFILE_TEMPLATE } from "./dockerfile-template";

export interface DockerfileOptions {
  claudeMdContent: string;
  additionalAptPackages?: string[];
  additionalNpmPackages?: string[];
}

export function buildDockerfile(options: DockerfileOptions): string {
  const aptPackages = options.additionalAptPackages?.join(" \\\n    ") ?? "";
  const npmPackages = options.additionalNpmPackages?.join(" ") ?? "";

  return DOCKERFILE_TEMPLATE.replace(
    "{{CLAUDE_MD_CONTENT}}",
    options.claudeMdContent
  )
    .replace("{{ADDITIONAL_APT_PACKAGES}}", aptPackages)
    .replace("{{ADDITIONAL_NPM_PACKAGES}}", npmPackages);
}
