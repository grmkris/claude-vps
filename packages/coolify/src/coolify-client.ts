import type { Logger } from "@vps-claude/logger";

import {
  type Environment,
  SERVICE_URLS,
} from "@vps-claude/shared/services.schema";
import { type NormalizeOAS, createClient } from "fets";
import { type Result, ok, err } from "neverthrow";

import type openapi from "./openapi";

import { type DockerfileOptions, buildDockerfile } from "./dockerfile-builder";

export type CoolifyError =
  | { type: "API_ERROR"; status: number; message: string }
  | { type: "INVALID_RESPONSE"; message: string }
  | { type: "TIMEOUT"; message: string };

export type DeploymentStatus =
  | "queued"
  | "in_progress"
  | "finished"
  | "failed"
  | "cancelled";

export interface DeploymentInfo {
  status: DeploymentStatus;
  logs?: string;
}

export interface WaitForDeploymentOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  onStatus?: (status: DeploymentStatus) => void;
}

type CoolifyOAS = NormalizeOAS<typeof openapi>;

export interface CoolifyClientConfig {
  env: Environment;
  apiToken: string;
  projectUuid: string;
  serverUuid: string;
  environmentName: string;
  environmentUuid: string;
  agentsDomain: string;
  logger: Logger;
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
    async createApplication(
      params: CreateApplicationParams
    ): Promise<Result<{ uuid: string; fqdn: string }, CoolifyError>> {
      const fqdn = `https://${params.subdomain}.${props.agentsDomain}`;
      props.logger.info(
        { subdomain: params.subdomain },
        "Creating application"
      );
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
          dockerfile: Buffer.from(dockerfile).toString("base64"),
          autogenerate_domain: false,
          ports_exposes: "8080,3000",
          name: params.subdomain,
          domains: fqdn,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        props.logger.error(
          { status: response.status, message: text },
          "Failed to create application"
        );
        return err({
          type: "API_ERROR",
          status: response.status,
          message: text,
        });
      }
      const data = await response.json();
      if (!data.uuid) {
        props.logger.error({}, "Missing uuid in response");
        return err({
          type: "INVALID_RESPONSE",
          message: "Missing uuid in response",
        });
      }

      // Set PASSWORD env var for code-server authentication
      props.logger.info({ uuid: data.uuid }, "Setting PASSWORD env var");
      const envResult = await this.updateApplicationEnv(data.uuid, {
        PASSWORD: params.password,
      });
      if (envResult.isErr()) {
        props.logger.error(
          { uuid: data.uuid, error: envResult.error },
          "Failed to set PASSWORD env var"
        );
        return err(envResult.error);
      }

      props.logger.info({ uuid: data.uuid, fqdn }, "Application created");
      return ok({ uuid: data.uuid, fqdn });
    },

    async getApplication(uuid: string) {
      props.logger.info({ uuid }, "Getting application");
      const response = await client["/applications/{uuid}"].get({
        params: { uuid },
      });
      if (!response.ok) {
        const text = await response.text();
        props.logger.error(
          { uuid, status: response.status, message: text },
          "Failed to get application"
        );
        return err({
          type: "API_ERROR" as const,
          status: response.status,
          message: text,
        });
      }
      return ok(await response.json());
    },

    async getApplicationStatus(
      uuid: string
    ): Promise<Result<{ status: string; isHealthy: boolean }, CoolifyError>> {
      const result = await this.getApplication(uuid);
      if (result.isErr()) return result;

      const status = (result.value as { status?: string }).status ?? "unknown";
      // Status can be "running", "running:unknown", "running:healthy", etc.
      const isHealthy = status.startsWith("running");
      const isRestarting = status.startsWith("restarting");
      const isExited = status === "exited" || status.includes("exited");

      if (isRestarting || isExited) {
        props.logger.warn({ uuid, status }, "Container unhealthy");
      }

      return ok({ status, isHealthy });
    },

    async waitForHealthy(
      uuid: string,
      options: {
        pollIntervalMs?: number;
        timeoutMs?: number;
        onStatus?: (status: string) => void;
      } = {}
    ): Promise<Result<{ status: string }, CoolifyError>> {
      const { pollIntervalMs = 5000, timeoutMs = 120000, onStatus } = options;
      const startTime = Date.now();
      let lastStatus: string | undefined;

      props.logger.info({ uuid }, "Waiting for container to be healthy");

      while (Date.now() - startTime < timeoutMs) {
        const result = await this.getApplicationStatus(uuid);
        if (result.isErr()) return result;

        const { status, isHealthy } = result.value;

        if (status !== lastStatus) {
          lastStatus = status;
          props.logger.info({ uuid, status }, "Container status");
          onStatus?.(status);
        }

        if (isHealthy) {
          props.logger.info({ uuid }, "Container is healthy");
          return ok({ status });
        }

        // Detect crash loop
        if (status.startsWith("restarting")) {
          props.logger.error({ uuid, status }, "Container in crash loop");
          return err({
            type: "API_ERROR",
            status: 500,
            message: `Container in crash loop: ${status}`,
          });
        }

        // Detect stopped/exited
        if (status === "exited" || status.includes("exited")) {
          props.logger.error({ uuid, status }, "Container exited");
          return err({
            type: "API_ERROR",
            status: 500,
            message: `Container exited unexpectedly: ${status}`,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      props.logger.error({ uuid, timeoutMs }, "Health check timed out");
      return err({
        type: "TIMEOUT",
        message: `Container health check timed out after ${timeoutMs}ms`,
      });
    },

    async getApplicationLogs(
      uuid: string,
      lines = 100
    ): Promise<Result<{ logs: string }, CoolifyError>> {
      props.logger.info({ uuid, lines }, "Getting application logs");
      const response = await client["/applications/{uuid}/logs"].get({
        params: { uuid },
        query: { lines },
      });
      if (!response.ok) {
        const text = await response.text();
        props.logger.error(
          { uuid, status: response.status, message: text },
          "Failed to get application logs"
        );
        return err({
          type: "API_ERROR",
          status: response.status,
          message: text,
        });
      }
      const data = (await response.json()) as { logs: string };
      return ok({ logs: data.logs ?? "" });
    },

    async deployApplication(
      uuid: string
    ): Promise<Result<{ deploymentUuid: string }, CoolifyError>> {
      props.logger.info({ uuid }, "Deploying application");
      const response = await client["/deploy"].get({
        query: { uuid, force: true },
      });
      if (!response.ok) {
        const text = await response.text();
        props.logger.error(
          { uuid, status: response.status, message: text },
          "Failed to deploy application"
        );
        return err({
          type: "API_ERROR",
          status: response.status,
          message: text,
        });
      }
      const data = (await response.json()) as {
        deployments: Array<{
          message: string;
          resource_uuid: string;
          deployment_uuid: string;
        }>;
      };
      const deploymentUuid = data.deployments?.[0]?.deployment_uuid;
      if (!deploymentUuid) {
        props.logger.error({ data }, "Missing deployment_uuid in response");
        return err({
          type: "INVALID_RESPONSE",
          message: "Missing deployment_uuid in response",
        });
      }
      props.logger.info({ uuid, deploymentUuid }, "Deployment started");
      return ok({ deploymentUuid });
    },

    async getDeployment(
      deploymentUuid: string
    ): Promise<Result<DeploymentInfo, CoolifyError>> {
      const response = await client["/deployments/{uuid}"].get({
        params: { uuid: deploymentUuid },
      });
      if (!response.ok) {
        const text = await response.text();
        props.logger.error(
          { deploymentUuid, status: response.status, message: text },
          "Failed to get deployment"
        );
        return err({
          type: "API_ERROR",
          status: response.status,
          message: text,
        });
      }
      const data = (await response.json()) as {
        status: DeploymentStatus;
        logs?: string;
      };
      return ok({ status: data.status, logs: data.logs });
    },

    async waitForDeployment(
      deploymentUuid: string,
      options: WaitForDeploymentOptions = {}
    ): Promise<Result<DeploymentInfo, CoolifyError>> {
      const { pollIntervalMs = 5000, timeoutMs = 600000, onStatus } = options;

      const startTime = Date.now();
      let lastStatus: DeploymentStatus | undefined;

      props.logger.info({ deploymentUuid }, "Waiting for deployment");

      while (Date.now() - startTime < timeoutMs) {
        const result = await this.getDeployment(deploymentUuid);
        if (result.isErr()) {
          return result;
        }

        const { status, logs } = result.value;

        if (status !== lastStatus) {
          lastStatus = status;
          props.logger.info({ deploymentUuid, status }, "Deployment status");
          onStatus?.(status);
        }

        if (
          status === "finished" ||
          status === "failed" ||
          status === "cancelled"
        ) {
          props.logger.info({ deploymentUuid, status }, "Deployment completed");
          return ok({ status, logs });
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      props.logger.error({ deploymentUuid, timeoutMs }, "Deployment timed out");
      return err({
        type: "TIMEOUT",
        message: `Deployment timed out after ${timeoutMs}ms`,
      });
    },

    async deleteApplication(uuid: string): Promise<Result<void, CoolifyError>> {
      props.logger.info({ uuid }, "Deleting application");
      const response = await client["/applications/{uuid}"].delete({
        params: { uuid },
        query: {
          delete_configurations: true,
          delete_volumes: true,
          docker_cleanup: true,
          delete_connected_networks: true,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        props.logger.error(
          { uuid, status: response.status, message: text },
          "Failed to delete application"
        );
        return err({
          type: "API_ERROR",
          status: response.status,
          message: text,
        });
      }
      props.logger.info({ uuid }, "Application deleted");
      return ok(undefined);
    },

    async getApplicationEnvs(
      uuid: string
    ): Promise<Result<Record<string, string>, CoolifyError>> {
      props.logger.info({ uuid }, "Getting application envs");
      const response = await client["/applications/{uuid}/envs"].get({
        params: { uuid },
      });
      if (!response.ok) {
        const text = await response.text();
        props.logger.error(
          { uuid, status: response.status, message: text },
          "Failed to get envs"
        );
        return err({
          type: "API_ERROR",
          status: response.status,
          message: text,
        });
      }
      const data = (await response.json()) as Array<{
        key: string;
        value: string;
        real_value?: string;
      }>;
      // Convert array to record, prefer real_value if available
      const envs: Record<string, string> = {};
      for (const env of data) {
        envs[env.key] = env.real_value ?? env.value;
      }
      return ok(envs);
    },

    async updateApplicationEnv(
      uuid: string,
      envVars: Record<string, string>
    ): Promise<Result<void, CoolifyError>> {
      props.logger.info(
        { uuid, envCount: Object.keys(envVars).length },
        "Updating application env"
      );
      for (const [key, value] of Object.entries(envVars)) {
        const response = await client["/applications/{uuid}/envs"].post({
          params: { uuid },
          json: { key, value, is_preview: false },
        });
        if (!response.ok) {
          const text = await response.text();
          props.logger.error(
            { uuid, key, status: response.status, message: text },
            "Failed to update env"
          );
          return err({
            type: "API_ERROR",
            status: response.status,
            message: text,
          });
        }
      }
      props.logger.info({ uuid }, "Application env updated");
      return ok(undefined);
    },
  };
}

export type CoolifyClient = ReturnType<typeof createCoolifyClient>;
