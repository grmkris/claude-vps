export const BOX_STATUSES = [
  "pending",
  "deploying",
  "running",
  "error",
  "deleted",
] as const;

export type BoxStatus = (typeof BOX_STATUSES)[number];

export const WORKER_CONFIG = {
  deployBox: {
    name: "deploy-box",
    pollInterval: 5000,
    maxAttempts: 60,
    timeout: 900000, // 15 min - overall job timeout
    buildTimeout: 600000, // 10 min - build/deployment wait
    healthCheckTimeout: 300000, // 5 min - health check wait
  },
  deleteBox: {
    name: "delete-box",
    timeout: 60000, // 1 min
  },
  deliverEmail: {
    name: "deliver-email",
    timeout: 30000, // 30 sec
  },
  sendEmail: {
    name: "send-email",
    timeout: 30000, // 30 sec
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
