// Extend service error types with these optional fields
export interface StructuredErrorFields {
  why?: string; // Root cause explanation
  fix?: string; // Suggested resolution
  link?: string; // Documentation URL
}

// Helper to map error type to HTTP status
const STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  ALREADY_EXISTS: 409,
  VALIDATION_FAILED: 400,
  INVALID_STATUS: 400,
  INTERNAL_ERROR: 500,
};

export function errorTypeToStatus(type: string): number {
  return STATUS_MAP[type] ?? 500;
}

// Parse error response on frontend
export function parseError(err: unknown): {
  message: string;
  status?: number;
  type?: string;
  why?: string;
  fix?: string;
  link?: string;
} {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as Record<string, unknown>).data as
      | Record<string, unknown>
      | undefined;
    return {
      message: (data?.message as string) ?? "Unknown error",
      status: data?.status as number | undefined,
      type: data?.type as string | undefined,
      why: data?.why as string | undefined,
      fix: data?.fix as string | undefined,
      link: data?.link as string | undefined,
    };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: String(err) };
}
