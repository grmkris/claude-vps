"use client";

import type { BoxId } from "@vps-claude/shared";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Play } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { client } from "@/utils/orpc";

interface BoxCommandRunnerProps {
  boxId: BoxId;
  className?: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function BoxCommandRunner({ boxId, className }: BoxCommandRunnerProps) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<
    Array<{ command: string; result: ExecResult }>
  >([]);
  const outputRef = useRef<HTMLDivElement>(null);

  const execMutation = useMutation({
    mutationFn: (cmd: string) =>
      client.boxDetails.exec({ id: boxId, command: cmd }),
    onSuccess: (result) => {
      setHistory((prev) => [...prev, { command, result }]);
      setCommand("");
      setTimeout(() => {
        outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
      }, 0);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || execMutation.isPending) return;
    execMutation.mutate(command.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className={`flex flex-col bg-[#0d0d0d] rounded-lg ${className ?? ""}`}>
      {/* Output area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-auto p-4 font-mono text-sm min-h-[300px] max-h-[400px]"
      >
        {history.length === 0 ? (
          <div className="text-zinc-500">
            Run a command to see output here...
          </div>
        ) : (
          history.map((entry, i) => (
            <div key={i} className="mb-4">
              <div className="flex items-center gap-2 text-zinc-400 mb-1">
                <span className="text-green-500">$</span>
                <span className="text-zinc-200">{entry.command}</span>
              </div>
              {entry.result.stdout && (
                <pre className="text-zinc-300 whitespace-pre-wrap break-all">
                  {entry.result.stdout}
                </pre>
              )}
              {entry.result.stderr && (
                <pre className="text-red-400 whitespace-pre-wrap break-all">
                  {entry.result.stderr}
                </pre>
              )}
              {entry.result.exitCode !== 0 && (
                <div className="text-yellow-500 text-xs mt-1">
                  Exit code: {entry.result.exitCode}
                </div>
              )}
            </div>
          ))
        )}
        {execMutation.isPending && (
          <div className="flex items-center gap-2 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running...
          </div>
        )}
        {execMutation.isError && (
          <div className="text-red-400">
            Error: {execMutation.error.message}
          </div>
        )}
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-800 p-3 flex gap-2"
      >
        <div className="flex-1 flex items-center gap-2 bg-zinc-900 rounded px-3 py-2">
          <span className="text-green-500 font-mono">$</span>
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter command..."
            rows={1}
            className="flex-1 bg-transparent text-zinc-200 font-mono text-sm outline-none resize-none placeholder:text-zinc-600"
            disabled={execMutation.isPending}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={!command.trim() || execMutation.isPending}
          className="px-3"
        >
          {execMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
