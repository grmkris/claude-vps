import type { ApiKeyPermissions } from "@vps-claude/auth";

import { ORPCError } from "@orpc/server";

export type ResourceType = keyof ApiKeyPermissions;

export function hasPermission(
  permissions: ApiKeyPermissions | undefined,
  resource: ResourceType,
  action: string
): boolean {
  if (!permissions) return false;
  const resourcePerms = permissions[resource];
  return resourcePerms?.includes(action as never) ?? false;
}

export function requirePermission(
  permissions: ApiKeyPermissions | undefined,
  resource: ResourceType,
  action: string
): void {
  if (!hasPermission(permissions, resource, action)) {
    throw new ORPCError("FORBIDDEN", {
      message: `Missing permission: ${resource}:${action}`,
    });
  }
}
