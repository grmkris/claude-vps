import { env } from "@vps-claude/env/server";

import type { CoolifyApplication, CreateApplicationResponse } from "./types";

export * from "./types";

type CoolifyConfig = {
  apiUrl: string;
  apiToken: string;
  projectUuid: string;
  serverUuid: string;
  environmentName: string;
  agentsDomain: string;
  agentRepoUrl: string;
};

function getConfig(): CoolifyConfig {
  return {
    apiUrl: env.COOLIFY_API_URL,
    apiToken: env.COOLIFY_API_TOKEN,
    projectUuid: env.COOLIFY_PROJECT_UUID,
    serverUuid: env.COOLIFY_SERVER_UUID,
    environmentName: env.COOLIFY_ENVIRONMENT_NAME,
    agentsDomain: env.AGENTS_DOMAIN,
    agentRepoUrl: env.AGENT_REPO_URL,
  };
}

async function coolifyFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const config = getConfig();
  const url = `${config.apiUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
      ...(options.headers instanceof Headers
        ? Object.fromEntries(options.headers.entries())
        : Array.isArray(options.headers)
          ? Object.fromEntries(options.headers)
          : options.headers),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Coolify API error: ${response.status} - ${text}`);
  }

  return response.json() as T;
}

export async function createApplication(params: {
  subdomain: string;
  password: string;
}): Promise<CreateApplicationResponse> {
  const config = getConfig();
  const fqdn = `https://${params.subdomain}.${config.agentsDomain}`;

  return coolifyFetch<CreateApplicationResponse>("/applications/public", {
    method: "POST",
    body: JSON.stringify({
      project_uuid: config.projectUuid,
      server_uuid: config.serverUuid,
      environment_name: config.environmentName,
      git_repository: config.agentRepoUrl,
      git_branch: "main",
      build_pack: "dockerfile",
      ports_exposes: "3000",
      name: params.subdomain,
      domains: fqdn,
      instant_deploy: false,
    }),
  });
}

export async function deployApplication(uuid: string): Promise<void> {
  await coolifyFetch(`/applications/${uuid}/deploy`, {
    method: "POST",
    body: JSON.stringify({ force: true }),
  });
}

export async function getApplication(
  uuid: string
): Promise<CoolifyApplication> {
  return coolifyFetch<CoolifyApplication>(`/applications/${uuid}`);
}

export async function deleteApplication(uuid: string): Promise<void> {
  await coolifyFetch(`/applications/${uuid}`, {
    method: "DELETE",
    body: JSON.stringify({
      delete_configurations: true,
      delete_volumes: true,
    }),
  });
}

export async function updateApplicationEnv(
  uuid: string,
  envVars: Record<string, string>
): Promise<void> {
  for (const [key, value] of Object.entries(envVars)) {
    await coolifyFetch(`/applications/${uuid}/envs`, {
      method: "POST",
      body: JSON.stringify({
        key,
        value,
        is_build_time: false,
        is_preview: false,
      }),
    });
  }
}
