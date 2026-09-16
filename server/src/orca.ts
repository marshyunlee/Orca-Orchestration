import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export interface CoordinatorCaller {
  identity: string;
  terminalHandle: string;
  incarnationId: string;
  hostId: string;
}

export type NativeOperation =
  | { kind: "create-run"; objective: string }
  | { kind: "bind-run"; runId: string }
  | { kind: "create-task"; runId: string; title: string; spec: string; dependencies: string[] }
  | { kind: "start-worker"; taskId: string; runId: string; assignment:
      | { kind: "member"; terminalHandle: string; workspacePath: string }
      | { kind: "new-worker"; agent: string; workspacePath: string; model?: string; effort?: string } }
  | { kind: "send-guidance"; dispatchId: string; body: string }
  | { kind: "stop-worker" | "retain-worker" | "release-worker"; dispatchId: string }
  | { kind: "inspect-request"; requestId: string }
  | { kind: "reply-question"; messageId: string; body: string };

export interface NativeReceipt {
  phase: "applied" | "failed" | "unknown";
  requestId: string | null;
  stage: string | null;
  runId: string | null;
  taskId: string | null;
  dispatchId: string | null;
  liveness: string | null;
  raw: unknown;
  error: string | null;
}

function buildNativeArguments(operation: NativeOperation, caller: CoordinatorCaller): string[] {
  const from = ["--from", caller.terminalHandle];
  let args: string[];
  switch (operation.kind) {
    case "create-run": args = ["run-create", "--objective", operation.objective, ...from]; break;
    case "bind-run": args = ["run-use", "--id", operation.runId, ...from]; break;
    case "create-task": args = ["task-create", "--spec", operation.spec, "--task-title", operation.title, "--deps", JSON.stringify(operation.dependencies), "--run", operation.runId, ...from]; break;
    case "start-worker": {
      const assignment = operation.assignment;
      if (assignment.kind === "member") {
        if (assignment.terminalHandle === caller.terminalHandle) throw new Error("The coordinator needs an explicit handover before becoming a worker");
        args = ["dispatch", "--task", operation.taskId, "--to", assignment.terminalHandle, "--run", operation.runId, "--inject", ...from];
      } else {
        args = ["worker-start", "--task", operation.taskId, "--worktree", `path:${assignment.workspacePath}`, "--agent", assignment.agent, "--run", operation.runId, ...from];
        if (assignment.model) args.push("--model", assignment.model);
        if (assignment.effort) args.push("--effort", assignment.effort);
      }
      break;
    }
    case "send-guidance": args = ["send", "--to", `dispatch:${operation.dispatchId}`, "--subject", "Board guidance", "--body", operation.body, ...from]; break;
    case "stop-worker": args = ["worker-stop", "--dispatch", operation.dispatchId]; break;
    case "retain-worker": args = ["worker-retain", "--dispatch", operation.dispatchId]; break;
    case "release-worker": args = ["worker-release", "--dispatch", operation.dispatchId]; break;
    case "inspect-request": args = ["request-show", "--request", operation.requestId]; break;
    case "reply-question": args = ["reply", "--id", operation.messageId, "--body", operation.body, ...from]; break;
    default: throw new Error("Unsupported native operation");
  }
  return ["orchestration", ...args, "--json"];
}

/** Called by boardctl inside the chosen coordinator, never by the web server. */
export async function executeNativeOperation(
  operation: NativeOperation,
  caller: CoordinatorCaller,
  options: { executable?: string; timeoutMs?: number } = {},
): Promise<NativeReceipt> {
  if (!caller.terminalHandle || process.env.ORCA_TERMINAL_HANDLE !== caller.terminalHandle) {
    throw new Error("Native operations must run inside the selected coordinator process");
  }
  const executable = options.executable ?? process.env.ORCA_CLI_COMMAND ?? (process.env.ORCA_DEV_REPO_ROOT ? "orca-dev" : "orca");
  const settings = { maxBuffer: 32 * 1024 * 1024, timeout: options.timeoutMs ?? 180_000 };
  const inspected = await pExecFile(executable, ["terminal", "show", "--terminal", caller.terminalHandle, "--json"], settings);
  const envelope = JSON.parse(inspected.stdout);
  const terminal = envelope.result?.terminal;
  if (!envelope.ok || !terminal || terminal.handle !== caller.terminalHandle ||
      terminal.incarnationId !== caller.incarnationId || terminal.executionHostId !== caller.hostId ||
      !terminal.connected || !terminal.writable || terminal.orphaned ||
      terminal.agentIdentity !== caller.identity.split(":")[0]) {
    throw new Error("Coordinator identity or incarnation changed; reconnect explicitly");
  }
  const args = buildNativeArguments(operation, caller);
  let stdout = "";
  let failure: string | null = null;
  try {
    stdout = (await pExecFile(executable, args, settings)).stdout;
  } catch (error) {
    const caught = error as { stdout?: string; message?: string };
    stdout = caught.stdout ?? "";
    failure = caught.message ?? String(error);
  }
  let raw: Record<string, any> | null = null;
  try { raw = JSON.parse(stdout); } catch { /* A lost receipt leaves the effect unknown. */ }
  const result = raw?.result ?? {};
  const stringOrNull = (value: unknown): string | null => typeof value === "string" ? value : null;
  return {
    phase: result.state === "outcome_unknown" ? "unknown" : raw?.ok === true ? "applied" : raw?.ok === false ? "failed" : "unknown",
    requestId: stringOrNull(result.mutation?.requestId ?? result.requestId ?? result.request_id ?? raw?.error?.data?.requestId),
    stage: stringOrNull(result.stage ?? result.failedStage),
    runId: stringOrNull(result.runId ?? result.run?.id ?? result.task?.run_id ?? result.dispatch?.run_id),
    taskId: stringOrNull(result.taskId ?? result.task?.id ?? result.dispatch?.task_id),
    dispatchId: stringOrNull(result.dispatchId ?? result.dispatch?.id),
    liveness: stringOrNull(result.liveness ?? result.projection?.liveness?.verdict),
    raw: raw ?? stdout,
    error: raw?.ok === false ? String(raw.error?.message ?? failure ?? "Native operation failed") : failure,
  };
}

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
