import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

/**
 * Read native Run/Task state with an explicit Run ID. Reads need no coordinator
 * binding; acquiring one would fence the conversation that owns the work.
 * Terminal closure is used only by the separately invoked uninstall command.
 */
export type TaskStatus =
  | "pending"
  | "ready"
  | "dispatched"
  | "completed"
  | "failed"
  | "blocked";

/**
 * An `orca ... --json` failure, carrying Orca's machine-readable error code and,
 * when the runtime offers one, the exact command that unblocks it (e.g. an
 * adopted Run answers `consumer_fenced` with a `run-use --takeover-legacy`).
 */
export class OrcaCliError extends Error {
  readonly code: string | null;
  readonly recoveryCommand: string | null;
  constructor(message: string, code: string | null = null, recoveryCommand: string | null = null) {
    super(message);
    this.name = "OrcaCliError";
    this.code = code;
    this.recoveryCommand = recoveryCommand;
  }
}

/**
 * A task row from `orchestration task-list --run <id> --json`.
 *
 * `deps` is a JSON-encoded *string* of task ids, not an array. `assignee_handle`
 * and `dispatch_id` are only present while `status === "dispatched"` — the
 * runtime strips them from every other row.
 */
export interface OrcaTask {
  id: string;
  parent_id: string | null;
  created_by_terminal_handle: string | null;
  spec: string;
  status: TaskStatus;
  deps: string;
  result: string | null;
  created_at: string;
  completed_at: string | null;
  task_title: string | null;
  display_name: string | null;
  run_id: string;
  assignee_handle?: string | null;
  dispatch_id?: string | null;
}

/** A lightweight orchestration Run: namespace + coordinator inbox. */
export interface OrcaRun {
  id: string;
  objective: string;
  coordinator_handle: string | null;
  consumer_generation: number;
  /** 1 for the inspect-only `run_legacy_local` audit tombstone. */
  legacy: number;
  created_at: string;
  updated_at: string;
}

export interface DagNode {
  id: string;
  label: string;
  status: TaskStatus;
  spec: string;
  result: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Live attempt, present only while dispatched. */
  dispatchId: string | null;
  assigneeHandle: string | null;
}

export interface DagEdge {
  id: string;
  source: string;
  target: string;
}

export interface Gate {
  id: string;
  taskId: string | null;
  question: string;
  options: string[];
  status: string;
  resolution: string | null;
  raw: Record<string, unknown>;
}

/**
 * Run `orca <args...> --json` and return the unwrapped `result` payload.
 * Throws an `OrcaCliError` carrying `error.code` when the runtime reports
 * `ok: false`, so callers can branch on `run_required` / `consumer_fenced`.
 */
export async function runOrca<T = unknown>(args: string[]): Promise<T> {
  const fullArgs = args.includes("--json") ? args : [...args, "--json"];
  let stdout: string;
  try {
    const res = await pExecFile("orca", fullArgs, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
    });
    stdout = res.stdout;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    // CLI failures can still carry structured JSON; preserve the error code.
    if (e.stdout && e.stdout.trim().startsWith("{")) {
      stdout = e.stdout;
    } else {
      throw new OrcaCliError(
        `orca ${fullArgs.join(" ")} failed: ${e.stderr || e.message || "unknown error"}`,
      );
    }
  }

  let parsed: {
    ok: boolean;
    result?: T;
    error?: { code?: string; message?: string; data?: { recoveryCommand?: string } };
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new OrcaCliError(`orca ${fullArgs.join(" ")} returned non-JSON: ${stdout.slice(0, 500)}`);
  }
  if (!parsed.ok) {
    const code = parsed.error?.code ?? null;
    const message = parsed.error?.message ?? JSON.stringify(parsed.error ?? parsed);
    const recovery = parsed.error?.data?.recoveryCommand ?? null;
    throw new OrcaCliError(
      `orca ${args[0]} ${args[1] ?? ""}: ${message}`.trim(),
      code,
      recovery,
    );
  }
  return parsed.result as T;
}

function parseDeps(deps: string | null | undefined): string[] {
  if (!deps) return [];
  try {
    const arr = JSON.parse(deps);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// --- Runs ------------------------------------------------------------------

/** List Runs, newest first. Read-only: needs no coordinator terminal. */
export async function listRuns(): Promise<OrcaRun[]> {
  const result = await runOrca<{ runs?: OrcaRun[] }>(["orchestration", "run-list", "--limit", "50"]);
  const runs = result.runs ?? [];
  return runs
    .filter((r) => r.legacy !== 1) // the audit tombstone is inspect-only and always empty
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// --- Read paths (no coordinator terminal needed) ---------------------------

/** Fetch a Run's tasks. Requires `--run`: an unscoped call fails `run_required`. */
export async function listTasks(runId: string): Promise<OrcaTask[]> {
  const result = await runOrca<{ tasks: OrcaTask[] }>([
    "orchestration",
    "task-list",
    "--run",
    runId,
  ]);
  return result.tasks ?? [];
}

/** Fetch a Run's decision gates, normalized for the UI. */
export async function listGates(runId: string): Promise<Gate[]> {
  const result = await runOrca<{ gates?: unknown[] }>([
    "orchestration",
    "gate-list",
    "--run",
    runId,
  ]);
  const raw = (result.gates ?? []) as Record<string, unknown>[];
  return raw.map((g) => normalizeGate(g));
}

function normalizeGate(g: Record<string, unknown>): Gate {
  let options: string[] = [];
  const rawOptions = g.options;
  if (Array.isArray(rawOptions)) {
    options = rawOptions.map(String);
  } else if (typeof rawOptions === "string") {
    try {
      const parsed = JSON.parse(rawOptions);
      if (Array.isArray(parsed)) options = parsed.map(String);
    } catch {
      options = rawOptions ? [rawOptions] : [];
    }
  }
  return {
    id: String(g.id ?? g.gate_id ?? ""),
    taskId: (g.task_id as string) ?? (g.taskId as string) ?? null,
    question: String(g.question ?? ""),
    options: options.length ? options : ["approved", "rejected"],
    status: String(g.status ?? "pending"),
    resolution: (g.resolution as string) ?? null,
    raw: g,
  };
}

// --- Terminals -------------------------------------------------------------

/** A live Orca-managed terminal. */
export interface OrcaTerminal {
  handle: string;
  worktreePath: string;
  worktreeId: string;
  branch: string;
  title: string;
  connected: boolean;
  writable: boolean;
}

export async function listTerminals(): Promise<OrcaTerminal[]> {
  const result = await runOrca<{ terminals?: Record<string, unknown>[] }>(["terminal", "list"]);
  return (result.terminals ?? []).map((t) => ({
    handle: String(t.handle ?? ""),
    worktreePath: String(t.worktreePath ?? ""),
    worktreeId: String(t.worktreeId ?? ""),
    branch: String(t.branch ?? "").replace(/^refs\/heads\//, ""),
    title: String(t.title ?? "").trim(),
    connected: Boolean(t.connected),
    writable: Boolean(t.writable),
  }));
}

/** Older viewer versions created terminals with this title. Used by uninstall. */
export const COORDINATOR_TITLE = "orca-dag coordinator";

/** Close a terminal. Best-effort: it may already be gone. */
export async function closeTerminal(handle: string): Promise<void> {
  try {
    await runOrca(["terminal", "close", "--terminal", handle]);
  } catch {
    /* already closed */
  }
}

// --- DAG projection --------------------------------------------------------

/** Transform a Run's task list into a nodes/edges DAG for the UI. */
export function tasksToDag(tasks: OrcaTask[]): { nodes: DagNode[]; edges: DagEdge[] } {
  const idSet = new Set(tasks.map((t) => t.id));
  const nodes: DagNode[] = tasks.map((t) => ({
    id: t.id,
    label: (t.display_name || t.task_title || t.spec || t.id).trim(),
    status: t.status,
    spec: t.spec,
    result: t.result,
    createdAt: t.created_at,
    completedAt: t.completed_at,
    dispatchId: t.dispatch_id ?? null,
    assigneeHandle: t.assignee_handle ?? null,
  }));

  const edges: DagEdge[] = [];
  for (const t of tasks) {
    for (const dep of parseDeps(t.deps)) {
      // Deps are Run-scoped in practice: task-list only returns this Run's rows,
      // so an id we don't know is a dangling edge and is dropped.
      if (idSet.has(dep)) {
        edges.push({ id: `${dep}__${t.id}`, source: dep, target: t.id });
      }
    }
  }
  return { nodes, edges };
}
