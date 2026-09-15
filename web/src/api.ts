import type { DagResponse, OrcaRun, ViewerConfig } from "./types";

/** An /api error that carries Orca's machine-readable error code. */
export class ApiError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      String(json.error ?? `HTTP ${res.status}`),
      typeof json.code === "string" ? json.code : null,
    );
  }
  return json as T;
}

/** Runs available to view. Tasks are Run-scoped since Orca 1.4.160. */
export async function fetchRuns(): Promise<OrcaRun[]> {
  const { runs } = await get<{ runs: OrcaRun[] }>("/api/runs");
  return runs ?? [];
}

/** The DAG of one Run. */
export async function fetchDag(runId: string, signal?: AbortSignal): Promise<DagResponse> {
  return get<DagResponse>(`/api/dag?run=${encodeURIComponent(runId)}`, signal);
}

/** Load the persisted viewer preferences (layout and selected Run). */
export async function fetchConfig(): Promise<Partial<ViewerConfig>> {
  return get<Partial<ViewerConfig>>("/api/config");
}

/** Merge a patch into the persisted viewer config. */
export async function saveConfig(patch: Partial<ViewerConfig>): Promise<void> {
  const res = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
}
