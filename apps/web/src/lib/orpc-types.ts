import type { client } from "@/utils/orpc";

// Extract success type (exclude error responses)
type ExtractSuccess<T> = Exclude<T, { code: string; message: string }>;

// ─── Box Types ────────────────────────────────────────────────────────────────

export type BoxListResponse = ExtractSuccess<
  Awaited<ReturnType<typeof client.box.list>>
>;
export type Box = BoxListResponse["boxes"][0];

export type BoxByIdResponse = ExtractSuccess<
  Awaited<ReturnType<typeof client.box.byId>>
>;

// Status type inferred from Box
export type BoxStatus = Box["status"];

// ─── Input Types ──────────────────────────────────────────────────────────────

export type CreateBoxInput = Parameters<typeof client.box.create>[0];
export type DeployBoxInput = Parameters<typeof client.box.deploy>[0];
export type DeleteBoxInput = Parameters<typeof client.box.delete>[0];
