"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import {
  type McpCatalogServer,
  type McpServerConfig,
  registryServerToConfig,
} from "@vps-claude/shared/mcp-registry";
import { Check, Loader2, Search, Server } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";

interface McpSelectorProps {
  value: Record<string, McpServerConfig>;
  onChange: (servers: Record<string, McpServerConfig>) => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function McpSelector({ value, onChange }: McpSelectorProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["mcp-catalog", debouncedSearch],
    queryFn: async ({ pageParam }) => {
      return orpc.mcp.catalog.call({
        search: debouncedSearch || undefined,
        cursor: pageParam,
        limit: 30,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const toggleServer = (server: McpCatalogServer) => {
    const serverName = server.name;
    if (value[serverName]) {
      const { [serverName]: _, ...rest } = value;
      onChange(rest);
    } else {
      const config = registryServerToConfig(server);
      if (config) {
        onChange({ ...value, [serverName]: config });
      }
    }
  };

  const selectedCount = Object.keys(value).length;
  const allServers = data?.pages.flatMap((page) => page.servers) ?? [];

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load MCP servers catalog. Please try again later.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium">MCP Servers (Optional)</Label>
        </div>
        {selectedCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {selectedCount} selected
          </span>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search MCP servers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      <div className="rounded-lg border bg-secondary/20 max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : allServers.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {search
              ? "No MCP servers match your search"
              : "No MCP servers available"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {allServers.map((server, index) => {
              const isSelected = !!value[server.name];
              const displayName = server.title || server.name.split("/").pop();
              const hasValidConfig = !!registryServerToConfig(server);
              return (
                <button
                  type="button"
                  key={`${server.name}-${index}`}
                  onClick={() => toggleServer(server)}
                  disabled={!hasValidConfig}
                  className={cn(
                    "w-full px-4 py-3 text-left transition-colors hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    isSelected && "bg-primary/5",
                    !hasValidConfig && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {displayName}
                        </span>
                        {server.primaryPackage && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {server.primaryPackage.registryType}
                          </span>
                        )}
                        {!server.primaryPackage && server.primaryRemote && (
                          <span className="shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300">
                            {server.primaryRemote.type}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {server.description}
                      </p>
                      {server.primaryPackage?.envVars &&
                        server.primaryPackage.envVars.length > 0 && (
                          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                            Requires:{" "}
                            {server.primaryPackage.envVars
                              .filter((v) => v.isRequired)
                              .map((v) => v.name)
                              .join(", ") || "optional env vars"}
                          </p>
                        )}
                      {!hasValidConfig &&
                        server.primaryRemote?.hasRequiredHeaders && (
                          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                            Requires auth headers (not yet supported)
                          </p>
                        )}
                    </div>
                  </div>
                </button>
              );
            })}
            {hasNextPage && (
              <div className="p-3 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        MCP servers from the{" "}
        <a
          href="https://modelcontextprotocol.io/registry/about"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          official registry
        </a>{" "}
        extend Claude with external tools and data sources.
      </p>
    </div>
  );
}
