import {
  type Environment,
  SERVICE_URLS,
} from "@vps-claude/shared/services.schema";
import { type NormalizeOAS, createClient } from "fets";

import type openapi from "./openapi";

import { type DockerfileOptions, buildDockerfile } from "./dockerfile-builder";

type CoolifyOAS = NormalizeOAS<typeof openapi>;

export interface CoolifyClientConfig {
  env: Environment;
  apiToken: string;
  projectUuid: string;
  serverUuid: string;
  environmentName: string;
  environmentUuid: string;
  agentsDomain: string;
}

export interface CreateApplicationParams extends DockerfileOptions {
  subdomain: string;
  password: string;
}

export function createCoolifyClient(props: CoolifyClientConfig) {
  const client = createClient<CoolifyOAS>({
    endpoint: SERVICE_URLS[props.env].coolify,
    globalParams: {
      headers: {
        Authorization: `Bearer ${props.apiToken}`,
      },
    },
  });

  return {
    async createApplication(params: CreateApplicationParams) {
      const fqdn = `https://${params.subdomain}.${props.agentsDomain}`;
      const dockerfile = buildDockerfile({
        claudeMdContent: params.claudeMdContent,
        additionalAptPackages: params.additionalAptPackages,
        additionalNpmPackages: params.additionalNpmPackages,
      });

      const response = await client["/applications/dockerfile"].post({
        json: {
          project_uuid: props.projectUuid,
          server_uuid: props.serverUuid,
          environment_name: props.environmentName,
          environment_uuid: props.environmentUuid,
          dockerfile,
          autogenerate_domain: false,
          ports_exposes: "8080,3000",
          name: params.subdomain,
          domains: fqdn,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Create failed: ${response.status} - ${text}`);
      }
      const data = await response.json();
      if (!data.uuid) {
        throw new Error(`Create failed: ${response.status} - ${data}`);
      }
      return {
        uuid: data.uuid,
        fqdn,
      };
    },

    async getApplication(uuid: string) {
      const response = await client["/applications/{uuid}"].get({
        params: { uuid },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Get failed: ${response.status} - ${text}`);
      }
      return response.json();
    },

    async deployApplication(uuid: string) {
      const response = await client["/deploy"].get({
        query: { uuid, force: true },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Deploy failed: ${response.status} - ${text}`);
      }
    },

    async deleteApplication(uuid: string) {
      const response = await client["/applications/{uuid}"].delete({
        params: { uuid },
        query: { delete_configurations: true, delete_volumes: true },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Delete failed: ${response.status} - ${text}`);
      }
    },

    async updateApplicationEnv(uuid: string, envVars: Record<string, string>) {
      for (const [key, value] of Object.entries(envVars)) {
        const response = await client["/applications/{uuid}/envs"].post({
          params: { uuid },
          json: { key, value, is_preview: false },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Env update failed: ${response.status} - ${text}`);
        }
      }
    },
  };
}

export type CoolifyClient = ReturnType<typeof createCoolifyClient>;
