import type { ContainerCreateOptions } from "dockerode";

import type { CreateBoxConfig } from "./types";

import { generateTraefikLabels } from "./traefik-labels";

// Default resource limits (Pro tier: 1 CPU, 2GB RAM)
const DEFAULT_RESOURCES = {
  cpuCores: 1,
  memoryGB: 2,
};

export function buildHardenedConfig(
  config: CreateBoxConfig,
  domain?: string,
  baseDir: string = "/mnt/devboxes",
  options?: { skipSeccomp?: boolean; skipHealthcheck?: boolean }
): ContainerCreateOptions {
  const networkName = `box-${config.subdomain}-network`;

  return {
    name: config.name,
    Image: config.image,
    Hostname: config.subdomain,

    // Environment variables
    Env: Object.entries(config.envVars).map(
      ([key, value]) => `${key}=${value}`
    ),

    // Working directory
    WorkingDir: "/home/coder",

    // User
    User: "1000:1000",

    // Labels (Traefik routing)
    Labels: generateTraefikLabels(
      config.subdomain,
      config.exposedPorts,
      domain
    ),

    // Host configuration
    HostConfig: {
      // Network
      NetworkMode: networkName,

      // Filesystem
      ReadonlyRootfs: true,
      Binds: [
        // Private workspace
        `${baseDir}/${config.userId}/agents/${config.boxId}/workspace:/home/coder/workspace:rw`,
        `${baseDir}/${config.userId}/agents/${config.boxId}/.config:/home/coder/.config:rw`,
        `${baseDir}/${config.userId}/agents/${config.boxId}/.cache:/home/coder/.cache:rw`,
        `${baseDir}/${config.userId}/agents/${config.boxId}/.inbox:/home/coder/.inbox:rw`,

        // Shared workspace
        `${baseDir}/${config.userId}/shared:/workspace/shared:rw`,

        // Writable /usr/local for package installs
        `${baseDir}/${config.userId}/agents/${config.boxId}/usr-local:/usr/local:rw`,
      ],

      // Tmpfs (ephemeral)
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,size=100m",
        "/run": "rw,noexec,nosuid,size=10m",
      },

      // Security
      CapDrop: ["ALL"],
      SecurityOpt: [
        "no-new-privileges",
        ...(options?.skipSeccomp
          ? []
          : ["seccomp=/etc/docker/seccomp-profiles/box-profile.json"]),
        "apparmor=docker-default", // AppArmor profile
      ],

      // Resources
      Memory: DEFAULT_RESOURCES.memoryGB * 1024 * 1024 * 1024,
      MemorySwap: DEFAULT_RESOURCES.memoryGB * 1024 * 1024 * 1024, // No swap
      NanoCpus: DEFAULT_RESOURCES.cpuCores * 1_000_000_000,
      PidsLimit: 200,

      // I/O limits (prevent noisy neighbors)
      // Note: BlkioWeight not supported on cgroupv2 (Docker Desktop)
      // Note: DeviceReadBps/DeviceWriteBps require device path detection
      // Enable if needed: DeviceReadBps: [{ Path: '/dev/sda', Rate: 100 * 1024 * 1024 }]

      // Restart policy
      RestartPolicy: {
        Name: "unless-stopped",
        MaximumRetryCount: 0,
      },

      // Logging
      LogConfig: {
        Type: "json-file",
        Config: {
          "max-size": "10m",
          "max-file": "3",
        },
      },
    },

    // Exposed ports (for Traefik)
    ExposedPorts: {
      "22/tcp": {},
      "8080/tcp": {},
      "9999/tcp": {},
    },

    // Health check (skip if disabled, uses Dockerfile healthcheck instead)
    ...(options?.skipHealthcheck
      ? {}
      : {
          Healthcheck: {
            Test: ["CMD", "curl", "-f", "http://localhost:8080/healthz"],
            Interval: 30_000_000_000, // 30s in nanoseconds
            Timeout: 10_000_000_000, // 10s
            Retries: 3,
            StartPeriod: 10_000_000_000, // 10s
          },
        }),
  };
}
