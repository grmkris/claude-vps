import type { ServerWebSocket } from "bun";
import type { Logger } from "@vps-claude/logger";
import type { EnvironmentService } from "../services/environment.service";

interface TerminalSession {
  envId: string;
  userId: string;
  containerWs?: WebSocket;
}

interface TerminalMessage {
  type: "input" | "resize" | "output";
  data?: string;
  cols?: number;
  rows?: number;
}

export function createTerminalHandler(deps: {
  environmentService: EnvironmentService;
  logger: Logger;
  getContainerWsUrl: (subdomain: string) => string;
}) {
  const { environmentService, logger, getContainerWsUrl } = deps;
  const sessions = new Map<ServerWebSocket<TerminalSession>, TerminalSession>();

  return {
    async open(ws: ServerWebSocket<TerminalSession>) {
      const { envId, userId } = ws.data;
      logger.info({ msg: "Terminal session opened", envId, userId });

      const env = await environmentService.getById(envId);
      if (!env || env.userId !== userId) {
        ws.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31mEnvironment not found or access denied\x1b[0m\r\n" }));
        ws.close(1008, "Unauthorized");
        return;
      }

      if (env.status !== "running") {
        ws.send(JSON.stringify({ type: "output", data: `\r\n\x1b[33mEnvironment is ${env.status}. Deploy it first.\x1b[0m\r\n` }));
        ws.close(1000, "Environment not running");
        return;
      }

      const containerWsUrl = getContainerWsUrl(env.subdomain);
      logger.info({ msg: "Connecting to container", containerWsUrl });

      try {
        const containerWs = new WebSocket(containerWsUrl);

        containerWs.onopen = () => {
          logger.info({ msg: "Connected to container terminal", envId });
        };

        containerWs.onmessage = (event) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "output", data: event.data }));
          }
        };

        containerWs.onerror = (error) => {
          logger.error({ msg: "Container WebSocket error", envId, error });
          ws.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31mConnection to container failed\x1b[0m\r\n" }));
        };

        containerWs.onclose = () => {
          logger.info({ msg: "Container connection closed", envId });
          if (ws.readyState === 1) {
            ws.close(1000, "Container disconnected");
          }
        };

        sessions.set(ws, { envId, userId, containerWs });
      } catch (error) {
        logger.error({ msg: "Failed to connect to container", envId, error });
        ws.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31mFailed to connect to container\x1b[0m\r\n" }));
        ws.close(1011, "Container connection failed");
      }
    },

    message(ws: ServerWebSocket<TerminalSession>, message: string | Buffer) {
      const session = sessions.get(ws);
      if (!session?.containerWs) return;

      try {
        const msg: TerminalMessage = JSON.parse(message.toString());

        if (msg.type === "input" && msg.data) {
          session.containerWs.send(msg.data);
        } else if (msg.type === "resize" && msg.cols && msg.rows) {
          session.containerWs.send(JSON.stringify({ type: "resize", cols: msg.cols, rows: msg.rows }));
        }
      } catch (error) {
        logger.error({ msg: "Invalid terminal message", error });
      }
    },

    close(ws: ServerWebSocket<TerminalSession>) {
      const session = sessions.get(ws);
      if (session) {
        logger.info({ msg: "Terminal session closed", envId: session.envId });
        session.containerWs?.close();
        sessions.delete(ws);
      }
    },
  };
}
