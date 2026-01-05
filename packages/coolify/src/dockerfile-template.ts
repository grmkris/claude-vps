export const BOX_BASE_IMAGE = "ghcr.io/vps-claude/box-base:latest";

export const DOCKERFILE_TEMPLATE = `# syntax=docker/dockerfile:1
FROM ${BOX_BASE_IMAGE}

USER root

{{APT_INSTALL}}
{{NPM_INSTALL}}
{{PIP_INSTALL}}
{{SKILL_MD_FILES}}

COPY --chown=coder:coder <<EOF /home/coder/CLAUDE.md
{{CLAUDE_MD_CONTENT}}
EOF

USER coder
WORKDIR /home/coder
`;
