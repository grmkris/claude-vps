import type { Logger } from "@vps-claude/logger";
import type {
  Container,
  ContainerCreateOptions,
  ContainerInfo,
} from "dockerode";
import type { Pack } from "tar-stream";

import Dockerode from "dockerode";
import { PassThrough } from "node:stream";
import tar from "tar-stream";

import type { ExecResult, FileInfo } from "../types";

export interface DockerClientOptions {
  /** Docker socket path (default: /var/run/docker.sock) or TCP URL */
  socketPath?: string;
  host?: string;
  port?: number;
  logger: Logger;
}

/**
 * Low-level Docker client wrapper around dockerode
 *
 * Provides typed wrappers for container operations, exec, and filesystem.
 */
export function createDockerClient(options: DockerClientOptions) {
  const { socketPath = "/var/run/docker.sock", host, port, logger } = options;

  const docker = host
    ? new Dockerode({ host, port })
    : new Dockerode({ socketPath });

  /**
   * Create a new container
   */
  async function createContainer(
    name: string,
    image: string,
    createOptions: Partial<ContainerCreateOptions>
  ): Promise<Container> {
    logger.info({ name, image }, "DockerClient: Creating container");

    // Pull image if not present
    try {
      await docker.getImage(image).inspect();
    } catch {
      logger.info({ image }, "DockerClient: Pulling image");
      const pullStream = await docker.pull(image);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(pullStream, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    }

    const container = await docker.createContainer({
      name,
      Image: image,
      ...createOptions,
    });

    await container.start();
    logger.info({ name, id: container.id }, "DockerClient: Container started");

    return container;
  }

  /**
   * Get container by name
   */
  async function getContainer(name: string): Promise<Container | null> {
    try {
      const container = docker.getContainer(name);
      await container.inspect(); // Throws if not found
      return container;
    } catch {
      return null;
    }
  }

  /**
   * List all containers (optionally filter by label)
   */
  async function listContainers(
    labelFilter?: string
  ): Promise<ContainerInfo[]> {
    const options: { all: boolean; filters?: { label: string[] } } = {
      all: true,
    };

    if (labelFilter) {
      options.filters = { label: [labelFilter] };
    }

    return docker.listContainers(options);
  }

  /**
   * Delete a container
   */
  async function deleteContainer(name: string, force = true): Promise<void> {
    const container = await getContainer(name);
    if (!container) {
      logger.warn({ name }, "DockerClient: Container not found for deletion");
      return;
    }

    logger.info({ name }, "DockerClient: Deleting container");
    await container.remove({ force, v: true });
  }

  /**
   * Execute command in container
   */
  async function exec(
    containerName: string,
    cmd: string[],
    opts?: { workingDir?: string; user?: string }
  ): Promise<ExecResult> {
    const container = await getContainer(containerName);
    if (!container) {
      throw new Error(`Container not found: ${containerName}`);
    }

    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: opts?.workingDir,
      User: opts?.user,
    });

    const stream = await exec.start({ Detach: false });

    // Collect output
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      // Docker multiplexes stdout/stderr in the same stream
      // First byte indicates stream type (1 = stdout, 2 = stderr)
      docker.modem.demuxStream(
        stream,
        {
          write: (chunk: Buffer) => {
            stdout.push(chunk);
            return true;
          },
          end: () => {},
        } as unknown as NodeJS.WritableStream,
        {
          write: (chunk: Buffer) => {
            stderr.push(chunk);
            return true;
          },
          end: () => {},
        } as unknown as NodeJS.WritableStream
      );

      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const inspectResult = await exec.inspect();
    const exitCode = inspectResult.ExitCode ?? 0;

    return {
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      exitCode,
    };
  }

  /**
   * Execute shell command in container (bash -c)
   */
  async function execShell(
    containerName: string,
    command: string,
    opts?: { workingDir?: string; user?: string }
  ): Promise<ExecResult> {
    return exec(containerName, ["/bin/bash", "-c", command], opts);
  }

  /**
   * Read file from container using docker cp (tar stream)
   */
  async function readFile(
    containerName: string,
    path: string
  ): Promise<Buffer> {
    const container = await getContainer(containerName);
    if (!container) {
      throw new Error(`Container not found: ${containerName}`);
    }

    const stream = await container.getArchive({ path });

    // Use tar-stream to extract properly
    const extract = tar.extract();
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      extract.on("entry", (_header, entryStream, next) => {
        entryStream.on("data", (chunk: Buffer) => chunks.push(chunk));
        entryStream.on("end", next);
        entryStream.on("error", reject);
      });

      extract.on("finish", () => {
        if (chunks.length === 0) {
          reject(new Error(`Empty or invalid tar archive for ${path}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });

      extract.on("error", reject);
      stream.pipe(extract);
    });
  }

  /**
   * Write file to container using docker cp (tar stream)
   */
  async function writeFile(
    containerName: string,
    path: string,
    content: Buffer | string
  ): Promise<void> {
    const container = await getContainer(containerName);
    if (!container) {
      throw new Error(`Container not found: ${containerName}`);
    }

    const data = typeof content === "string" ? Buffer.from(content) : content;
    const fileName = path.split("/").pop() ?? "file";
    const dirPath = path.substring(0, path.lastIndexOf("/")) || "/";

    // Create tar archive using tar-stream (handles long filenames, pax headers correctly)
    const pack: Pack = tar.pack();
    const passThrough = new PassThrough();

    pack.pipe(passThrough);
    pack.entry({ name: fileName, size: data.length }, data);
    pack.finalize();

    await container.putArchive(passThrough, { path: dirPath });
  }

  /**
   * List directory in container
   */
  async function listDir(
    containerName: string,
    path: string
  ): Promise<FileInfo[]> {
    // Use ls -la to get file info (without silent fallback - we want real errors)
    const result = await execShell(
      containerName,
      `ls -la --time-style=long-iso "${path}"`
    );

    // Throw on actual errors (permission denied, not found, etc.)
    if (result.exitCode !== 0) {
      throw new Error(
        `listDir failed for ${path}: ${result.stderr || result.stdout}`
      );
    }

    // Empty directory returns only "total 0" line
    if (!result.stdout.trim()) {
      return [];
    }

    const lines = result.stdout.trim().split("\n").slice(1); // Skip "total" line
    const files: FileInfo[] = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 8) continue;

      const mode = parts[0] ?? "";
      const size = Number.parseInt(parts[4] ?? "0", 10);
      const date = parts[5] ?? "";
      const time = parts[6] ?? "";
      const name = parts.slice(7).join(" ");

      if (name === "." || name === "..") continue;

      files.push({
        name,
        path: `${path}/${name}`.replace(/\/+/g, "/"),
        isDir: mode.startsWith("d"),
        size,
        modTime: `${date}T${time}`,
        mode,
      });
    }

    return files;
  }

  return {
    docker,
    createContainer,
    getContainer,
    listContainers,
    deleteContainer,
    exec,
    execShell,
    readFile,
    writeFile,
    listDir,
  };
}

export type DockerClient = ReturnType<typeof createDockerClient>;
