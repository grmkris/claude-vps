import { createLogger } from "@vps-claude/logger";
import { Environment, SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { z } from "zod";

import { createCoolifyClient } from "../src/coolify-client";

const EnvSchema = z.object({
  APP_ENV: Environment,
  COOLIFY_API_TOKEN: z.string(),
  COOLIFY_PROJECT_UUID: z.string(),
  COOLIFY_SERVER_UUID: z.string(),
  COOLIFY_ENVIRONMENT_NAME: z.string(),
  COOLIFY_ENVIRONMENT_UUID: z.string(),
});

const env = EnvSchema.parse(process.env);
const logger = createLogger({ appName: "deploy-test" });

const client = createCoolifyClient({
  env: env.APP_ENV,
  apiToken: env.COOLIFY_API_TOKEN,
  projectUuid: env.COOLIFY_PROJECT_UUID,
  serverUuid: env.COOLIFY_SERVER_UUID,
  environmentName: env.COOLIFY_ENVIRONMENT_NAME,
  environmentUuid: env.COOLIFY_ENVIRONMENT_UUID,
  agentsDomain: SERVICE_URLS[env.APP_ENV].agentsDomain,
  logger,
});

const subdomain = `test-${Date.now()}`;

logger.info({ subdomain }, "Creating application");

const createResult = await client.createApplication({
  subdomain,
  password: "testpass123",
  claudeMdContent: "# Test Box\n\nDeployed via CLI script.",
});

if (createResult.isErr()) {
  logger.error({ error: createResult.error }, "Failed to create");
  process.exit(1);
}

const { uuid, fqdn, containerName } = createResult.value;
logger.info({ uuid, fqdn, containerName }, "Created");

logger.info({ uuid }, "Deploying");
const deployResult = await client.deployApplication(uuid);

if (deployResult.isErr()) {
  logger.error({ error: deployResult.error }, "Failed to deploy");
  process.exit(1);
}

const { deploymentUuid } = deployResult.value;
logger.info({ deploymentUuid }, "Waiting for deployment");

const waitResult = await client.waitForDeployment(deploymentUuid, {
  pollIntervalMs: 5000,
  timeoutMs: 300000,
});

if (waitResult.isErr()) {
  logger.error({ error: waitResult.error }, "Deployment failed");
  process.exit(1);
}

logger.info({ status: waitResult.value.status }, "Deployment done");

logger.info({ uuid }, "Waiting for healthy");
const healthResult = await client.waitForHealthy(uuid, {
  pollIntervalMs: 5000,
  timeoutMs: 120000,
});

if (healthResult.isErr()) {
  logger.error({ error: healthResult.error }, "Health check failed");
} else {
  logger.info({ status: healthResult.value.status }, "Healthy");
}

console.log("\n=== DEPLOYED ===");
console.log("URL:", fqdn);
console.log("SSH:", `ssh ${subdomain}@ssh.claude-vps.grm.wtf`);
console.log("Password: testpass123");
