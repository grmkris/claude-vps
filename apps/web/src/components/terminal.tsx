"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "xterm/css/xterm.css";

interface TerminalProps {
  environmentId: string;
  wsUrl: string;
  onClose?: () => void;
}

export function Terminal({ environmentId, wsUrl, onClose }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const connect = useCallback(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "JetBrains Mono, Menlo, Monaco, monospace",
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
        black: "#32344a",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#ad8ee6",
        cyan: "#449dab",
        white: "#787c99",
        brightBlack: "#444b6a",
        brightRed: "#ff7a93",
        brightGreen: "#b9f27c",
        brightYellow: "#ff9e64",
        brightBlue: "#7da6ff",
        brightMagenta: "#bb9af7",
        brightCyan: "#0db9d7",
        brightWhite: "#acb0d0",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln("\x1b[33mConnecting to environment...\x1b[0m");

    const ws = new WebSocket(`${wsUrl}?envId=${environmentId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("\x1b[32mConnected!\x1b[0m\r\n");
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "output") {
        term.write(data.data);
      }
    };

    ws.onerror = () => {
      term.writeln("\x1b[31mConnection error\x1b[0m");
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[33mDisconnected\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
  }, [environmentId, wsUrl]);

  useEffect(() => {
    connect();

    const handleResize = () => {
      fitAddonRef.current?.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      wsRef.current?.close();
      xtermRef.current?.dispose();
    };
  }, [connect]);

  return (
    <div className="relative h-full w-full min-h-[400px] bg-[#1a1b26] rounded-lg overflow-hidden">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      <div ref={terminalRef} className="h-full w-full p-2" />
    </div>
  );
}
