import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** View preferences plus historic execution choices retained as user data. */
export interface ViewerConfig {
  defaultHarness?: string;
  harnessByTask?: Record<string, string>;
  /** Stored for preservation only; never used to identify or launch a worker. */
  modelByTask?: Record<string, string>;
  maxConcurrency?: number;
  layout?: string;
  /** Last Run the user was looking at — tasks are Run-scoped since Orca 1.4.160. */
  runId?: string;
}

const FILE_NAME = ".orca-dag.config.json";

function configPath(workspaceDir: string): string {
  return join(workspaceDir, FILE_NAME);
}

/** Read the stored config; any failure (missing file, bad JSON) means "empty". */
export async function loadConfig(workspaceDir: string): Promise<ViewerConfig> {
  try {
    const raw = JSON.parse(await readFile(configPath(workspaceDir), "utf8")) as unknown;
    return sanitize(raw);
  } catch {
    return {};
  }
}

/** Merge a patch into the stored config and write it back (tmp + rename). */
export async function saveConfig(workspaceDir: string, patch: unknown): Promise<ViewerConfig> {
  const next = { ...(await loadConfig(workspaceDir)), ...sanitize(patch) };
  const file = configPath(workspaceDir);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(tmp, file);
  return next;
}

/** Keep only known, well-typed keys so a hand-edited or malicious file can't poison us. */
function sanitize(raw: unknown): ViewerConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: ViewerConfig = {};
  if (typeof r.defaultHarness === "string" && r.defaultHarness.trim()) {
    out.defaultHarness = r.defaultHarness.trim();
  }
  if (r.harnessByTask && typeof r.harnessByTask === "object" && !Array.isArray(r.harnessByTask)) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.harnessByTask as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) map[k] = v.trim();
    }
    out.harnessByTask = map;
  }
  if (r.modelByTask && typeof r.modelByTask === "object" && !Array.isArray(r.modelByTask)) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.modelByTask as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) map[k] = v.trim();
    }
    out.modelByTask = map;
  }
  if (typeof r.maxConcurrency === "number" && Number.isFinite(r.maxConcurrency)) {
    out.maxConcurrency = Math.max(1, Math.min(16, Math.round(r.maxConcurrency)));
  }
  if (typeof r.layout === "string" && r.layout.trim()) {
    out.layout = r.layout.trim();
  }
  if (typeof r.runId === "string" && r.runId.trim()) {
    out.runId = r.runId.trim();
  }
  return out;
}
