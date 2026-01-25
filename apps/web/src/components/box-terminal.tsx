"use client";

import type { BoxId } from "@vps-claude/shared";

import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { useEffect, useRef, useState } from "react";

import { env } from "@/env";

// xterm imports - dynamically loaded to avoid SSR issues
let Terminal: typeof import("@xterm/xterm").Terminal | null = null;
let FitAddon: typeof import("@xterm/addon-fit").FitAddon | null = null;
let WebLinksAddon:
  | typeof import("@xterm/addon-web-links").WebLinksAddon
  | null = null;

interface BoxTerminalProps {
  boxId: BoxId;
  className?: string;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export function BoxTerminal({ boxId, className }: BoxTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<InstanceType<
    typeof import("@xterm/xterm").Terminal
  > | null>(null);
  const fitAddonRef = useRef<InstanceType<
    typeof import("@xterm/addon-fit").FitAddon
  > | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;

    async function initTerminal() {
      if (!terminalRef.current || !mounted) return;

      // Dynamically import xterm modules
      if (!Terminal) {
        const xtermModule = await import("@xterm/xterm");
        Terminal = xtermModule.Terminal;

        // @ts-expect-error CSS module import
        await import("@xterm/xterm/css/xterm.css");
      }

      if (!FitAddon) {
        const fitModule = await import("@xterm/addon-fit");
        FitAddon = fitModule.FitAddon;
      }

      if (!WebLinksAddon) {
        const webLinksModule = await import("@xterm/addon-web-links");
        WebLinksAddon = webLinksModule.WebLinksAddon;
      }

      // Create terminal
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily:
          "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
        fontSize: 14,
        lineHeight: 1.2,
        theme: {
          background: "#0d0d0d",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          cursorAccent: "#0d0d0d",
          selectionBackground: "#3f3f46",
          black: "#18181b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#e4e4e7",
          brightBlack: "#52525b",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
        },
      });

      termRef.current = term;

      // Load addons
      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      term.loadAddon(fitAddon);

      const webLinksAddon = new WebLinksAddon();
      term.loadAddon(webLinksAddon);

      // Open terminal
      term.open(terminalRef.current);
      fitAddon.fit();

      // Set up resize observer
      resizeObserver = new ResizeObserver(() => {
        if (fitAddonRef.current && termRef.current) {
          fitAddonRef.current.fit();
          // Send resize to server if connected
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "resize",
                cols: termRef.current.cols,
                rows: termRef.current.rows,
              })
            );
          }
        }
      });
      resizeObserver.observe(terminalRef.current);

      // Connect WebSocket
      const apiUrl = SERVICE_URLS[env.NEXT_PUBLIC_ENV].api;
      const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws";
      const wsHost = apiUrl.replace(/^https?:\/\//, "");
      const wsUrl = `${wsProtocol}://${wsHost}/ws/box/${boxId}/terminal?cols=${term.cols}&rows=${term.rows}`;

      term.writeln("Connecting to terminal...");

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (!mounted) return;
        setStatus("connected");
        term.clear();
        term.focus();
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
        } else if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data) as {
              type?: string;
              exit_code?: number;
            };
            if (msg.type === "exit") {
              term.writeln(`\r\n[Process exited: ${msg.exit_code ?? 0}]`);
              setStatus("disconnected");
            } else if (msg.type === "session_info") {
              // Session established
              setStatus("connected");
            }
          } catch {
            // Not JSON, write as text
            term.write(event.data);
          }
        }
      };

      ws.onerror = () => {
        if (!mounted) return;
        setError("Connection error");
        setStatus("error");
      };

      ws.onclose = (event) => {
        if (!mounted) return;
        if (event.code !== 1000) {
          setError(`Connection closed: ${event.reason || "Unknown error"}`);
          setStatus("error");
        } else {
          setStatus("disconnected");
        }
      };

      // Forward terminal input to WebSocket
      term.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(data);
        }
      });
    }

    void initTerminal();

    return () => {
      mounted = false;
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
    };
  }, [boxId]);

  return (
    <div className={`relative ${className ?? ""}`}>
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d0d] text-zinc-400 z-10">
          <span className="animate-pulse">Connecting...</span>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0d0d] text-red-400 z-10 gap-2">
          <span>Connection failed</span>
          {error && <span className="text-sm text-zinc-500">{error}</span>}
        </div>
      )}
      <div
        ref={terminalRef}
        className="h-full w-full bg-[#0d0d0d] rounded-lg overflow-hidden"
        style={{ minHeight: 400 }}
      />
    </div>
  );
}
