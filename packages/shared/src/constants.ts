export const BOX_STATUSES = [
  "pending",
  "deploying",
  "running",
  "error",
  "deleted",
] as const;

export type BoxStatus = (typeof BOX_STATUSES)[number];

export const WORKER_CONFIG = {
  // Legacy monolithic deploy worker (being replaced by modular workers)
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

  // Modular deploy workers with retry/backoff
  deployOrchestrator: {
    name: "deploy-orchestrator",
    timeout: 900000, // 15 min - overall orchestration
    attempts: 1, // Orchestrator doesn't retry - children retry independently
    concurrency: 5,
  },
  createSprite: {
    name: "deploy-create-sprite",
    timeout: 120000, // 2 min
    attempts: 3,
    backoff: {
      type: "exponential" as const,
      delay: 30000, // 30s, 60s, 120s
    },
    concurrency: 5,
  },
  setupStep: {
    name: "deploy-setup-step",
    timeout: 180000, // 3 min per step
    attempts: 3,
    backoff: {
      type: "exponential" as const,
      delay: 10000, // 10s, 20s, 40s
    },
    concurrency: 10,
  },
  healthCheck: {
    name: "deploy-health-check",
    timeout: 120000, // 2 min
    attempts: 5,
    backoff: {
      type: "exponential" as const,
      delay: 10000, // 10s, 20s, 40s, 80s, 160s
    },
    concurrency: 10,
  },
  installSkill: {
    name: "deploy-install-skill",
    timeout: 180000, // 3 min per skill
    attempts: 2,
    backoff: {
      type: "exponential" as const,
      delay: 5000, // 5s, 10s
    },
    concurrency: 5,
  },
  enableAccess: {
    name: "deploy-enable-access",
    timeout: 30000, // 30 sec
    attempts: 3,
    backoff: {
      type: "exponential" as const,
      delay: 10000, // 10s, 20s, 40s
    },
    concurrency: 10,
  },
  finalize: {
    name: "deploy-finalize",
    timeout: 30000, // 30 sec
    attempts: 1, // No retries - just marks box as running
    concurrency: 10,
  },
  skillsGate: {
    name: "deploy-skills-gate",
    timeout: 30000, // 30 sec
    attempts: 1, // No retries - aggregates skill results
    concurrency: 10,
  },

  // Cronjob worker
  triggerCronjob: {
    name: "trigger-cronjob",
    timeout: 300000, // 5 min execution
    wakeTimeout: 120000, // 2 min to wake sprite
    concurrency: 10,
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
