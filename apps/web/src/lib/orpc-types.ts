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

// ─── Email Types ─────────────────────────────────────────────────────────────

export type BoxEmailsResponse = ExtractSuccess<
  Awaited<ReturnType<typeof client.box.emails>>
>;
export type BoxEmail = BoxEmailsResponse["emails"][0];

// ─── Filesystem Types ────────────────────────────────────────────────────────

export type FsListResponse = ExtractSuccess<
  Awaited<ReturnType<typeof client.boxFs.list>>
>;
export type FileEntry = FsListResponse["entries"][0];

export type FsReadResponse = ExtractSuccess<
  Awaited<ReturnType<typeof client.boxFs.read>>
>;

export type FsWriteResponse = ExtractSuccess<
  Awaited<ReturnType<typeof client.boxFs.write>>
>;
