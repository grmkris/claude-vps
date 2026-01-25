import type { Auth } from "@vps-claude/auth";
import type { Logger } from "@vps-claude/logger";
import type { BoxId, UserId } from "@vps-claude/shared";
import type { SpritesClient } from "@vps-claude/sprites";
import type { ServerWebSocket } from "bun";

import type { BoxService } from "../services/box.service";

export interface TerminalConnectionData {
  boxId: BoxId;
  userId: UserId;
  spriteName: string;
  cols: number;
  rows: number;
  upstream: WebSocket | null;
}

export interface WebSocketTerminalHandlerDeps {
  boxService: BoxService;
  spritesClient: SpritesClient;
  auth: Auth;
  logger: Logger;
}

/**
 * Creates WebSocket terminal handler for proxying terminal connections
 * between browser and Sprites Exec API.
 *
 * Flow:
 * 1. Browser connects to /ws/box/:id/terminal
 * 2. validateUpgrade checks session cookie, box ownership, and box status
 * 3. On WS open, connects upstream to Sprites exec API
 * 4. Binary/text messages are proxied bidirectionally
 */
export function createWebSocketTerminalHandler(
  deps: WebSocketTerminalHandlerDeps
) {
  const { boxService, spritesClient, auth, logger } = deps;

  /**
   * Validate WebSocket upgrade request
   * Returns connection data if valid, null otherwise
   */
  async function validateUpgrade(
    req: Request,
    boxId: string
  ): Promise<TerminalConnectionData | null> {
    // 1. Validate session from cookie
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      logger.warn({ boxId }, "Terminal WS: No valid session");
      return null;
    }

    const userId = session.user.id as UserId;

    // 2. Verify box ownership and status
    const boxResult = await boxService.getById(boxId as BoxId);
    if (boxResult.isErr()) {
      logger.warn(
        { boxId, error: boxResult.error },
        "Terminal WS: Box lookup failed"
      );
      return null;
    }

    const box = boxResult.value;
    if (!box) {
      logger.warn({ boxId }, "Terminal WS: Box not found");
      return null;
    }

    if (box.userId !== userId) {
      logger.warn({ boxId, userId }, "Terminal WS: User doesn't own box");
      return null;
    }

    if (box.status !== "running") {
      logger.warn(
        { boxId, status: box.status },
        "Terminal WS: Box not running"
      );
      return null;
    }

    if (!box.spriteName) {
      logger.warn({ boxId }, "Terminal WS: Box has no sprite");
      return null;
    }

    // 3. Parse terminal dimensions from query params
    const url = new URL(req.url);
    const cols = Number.parseInt(url.searchParams.get("cols") ?? "80", 10);
    const rows = Number.parseInt(url.searchParams.get("rows") ?? "24", 10);

    logger.info(
      { boxId, userId, spriteName: box.spriteName, cols, rows },
      "Terminal WS: Validated"
    );

    return {
      boxId: box.id,
      userId,
      spriteName: box.spriteName,
      cols: Number.isNaN(cols) ? 80 : cols,
      rows: Number.isNaN(rows) ? 24 : rows,
      upstream: null,
    };
  }

  /**
   * Build Sprites exec WebSocket URL
   */
  function buildExecUrl(
    spriteName: string,
    cols: number,
    rows: number
  ): string {
    // Sprites exec API: wss://api.sprites.dev/v1/sprites/{name}/exec?cmd=bash&tty=true&cols=X&rows=Y
    const baseUrl = spritesClient.getProxyUrl(spriteName);
    // getProxyUrl returns proxy URL, we need exec URL
    // Convert: wss://api.sprites.dev/v1/sprites/{name}/proxy -> wss://api.sprites.dev/v1/sprites/{name}/exec
    const execUrl = baseUrl.replace(/\/proxy$/, "/exec");
    const url = new URL(execUrl);
    url.searchParams.set("cmd", "bash");
    url.searchParams.set("tty", "true");
    url.searchParams.set("cols", cols.toString());
    url.searchParams.set("rows", rows.toString());
    return url.toString();
  }

  /**
   * Bun WebSocket handlers
   */
  const handlers = {
    /**
     * Called when WebSocket connection is opened
     * Establishes upstream connection to Sprites
     */
    open(ws: ServerWebSocket<TerminalConnectionData>) {
      const { spriteName, cols, rows, boxId } = ws.data;

      logger.info({ boxId, spriteName }, "Terminal WS: Connection opened");

      // Connect to Sprites exec API
      const execUrl = buildExecUrl(spriteName, cols, rows);
      const token = spritesClient.getToken();

      const upstream = new WebSocket(execUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      } as WebSocket extends {
        new (
          url: string,
          protocols?: string | string[],
          options?: { headers?: Record<string, string> }
        ): WebSocket;
      }
        ? { headers: Record<string, string> }
        : never);

      // Store upstream reference
      ws.data.upstream = upstream;

      upstream.binaryType = "arraybuffer";

      upstream.onopen = () => {
        logger.info({ boxId, spriteName }, "Terminal WS: Upstream connected");
      };

      upstream.onmessage = (event) => {
        // Forward upstream data to browser
        if (event.data instanceof ArrayBuffer) {
          ws.sendBinary(new Uint8Array(event.data));
        } else {
          ws.send(event.data as string);
        }
      };

      upstream.onerror = (event) => {
        const errorMessage =
          event instanceof ErrorEvent ? event.message : "Unknown error";
        logger.error(
          { boxId, spriteName, error: errorMessage },
          "Terminal WS: Upstream error"
        );
        ws.close(1011, "Upstream connection error");
      };

      upstream.onclose = (event) => {
        logger.info(
          { boxId, spriteName, code: event.code, reason: event.reason },
          "Terminal WS: Upstream closed"
        );
        // Send exit message to browser
        ws.send(
          JSON.stringify({
            type: "exit",
            exit_code: event.code === 1000 ? 0 : 1,
          })
        );
        ws.close(event.code, event.reason);
      };
    },

    /**
     * Called when message is received from browser
     * Forwards to upstream Sprites connection
     */
    message(
      ws: ServerWebSocket<TerminalConnectionData>,
      message: string | Buffer
    ) {
      const { upstream } = ws.data;

      if (!upstream || upstream.readyState !== WebSocket.OPEN) {
        logger.warn(
          { boxId: ws.data.boxId },
          "Terminal WS: Upstream not ready"
        );
        return;
      }

      // Forward message to upstream
      if (message instanceof Buffer) {
        upstream.send(message);
      } else if (typeof message === "string") {
        // Check if it's a control message (resize)
        try {
          const parsed = JSON.parse(message) as {
            type?: string;
            cols?: number;
            rows?: number;
          };
          if (parsed.type === "resize" && parsed.cols && parsed.rows) {
            // Send resize control message
            upstream.send(JSON.stringify(parsed));
            return;
          }
        } catch {
          // Not JSON, treat as terminal input
        }
        // Forward as terminal input
        upstream.send(message);
      }
    },

    /**
     * Called when browser WebSocket is closed
     * Cleans up upstream connection
     */
    close(
      ws: ServerWebSocket<TerminalConnectionData>,
      code: number,
      reason: string
    ) {
      const { upstream, boxId, spriteName } = ws.data;

      logger.info(
        { boxId, spriteName, code, reason },
        "Terminal WS: Connection closed"
      );

      if (upstream) {
        upstream.close();
        ws.data.upstream = null;
      }
    },
  };

  return {
    validateUpgrade,
    handlers,
    // Export for testing
    _buildExecUrl: buildExecUrl,
  };
}

export type WebSocketTerminalHandler = ReturnType<
  typeof createWebSocketTerminalHandler
>;
