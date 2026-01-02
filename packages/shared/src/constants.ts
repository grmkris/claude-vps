export const ENVIRONMENT_STATUSES = [
  "pending",
  "deploying",
  "running",
  "error",
  "deleted",
] as const;

export type EnvironmentStatus = (typeof ENVIRONMENT_STATUSES)[number];

export const WORKER_CONFIG = {
  deployEnvironment: {
    name: "deploy-environment",
    pollInterval: 5000,
    maxAttempts: 60, // 5 min max
    timeout: 300000, // 5 min
  },
  deleteEnvironment: {
    name: "delete-environment",
    timeout: 60000, // 1 min
  },
} as const;

export const NUMERIC_CONSTANTS = {
  pagination: {
    minLimit: 1,
    maxLimit: 100,
    defaultLimit: 20,
  },
  subdomain: {
    suffixLength: 4,
  },
} as const;
