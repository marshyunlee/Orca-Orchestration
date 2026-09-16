import {emptyCollection, type ImportedWork, type CollectionState} from './imports.js';
import type { ComponentBinding, ComponentState, DependencyEvidence } from "./collaborate.js";
export type AgentSource = "codex" | "claude" | "cursor" | "other";
export type NodeKind = "run" | "task" | "preview";
export interface MemberRef {
  identity: string; source: AgentSource; sessionId: string;
  tabId: string; tabName: string; terminalHandle: string;
  incarnationId: string; hostId: string; workspacePath: string;
}
export type Assignment =
  | { kind: "member"; identity: string }
  | { kind: "new-worker"; agent: string; workspacePath: string; model?: string; effort?: string };
export interface NodeContent { prompt: string; plan: string; design: string; implementationNotes: string }
export interface BoardNode {
  id: string; kind: NodeKind; title: string; revision: number;
  content: NodeContent; assignment: Assignment | null; collaborate?: ComponentBinding; imported?: ImportedWork;
  position: { x: number; y: number }; removed: boolean;
}
export interface BoardEdge { id: string; source: string; target: string; importedKey?: string }
export interface AttemptRef {
  id: string; nodeId: string; nodeRevision: number; runId: string;
  taskId: string; dispatchId: string; assigneeHandle: string | null;
  ownsProcess: boolean; nativeStatus: string; workspacePath: string;
  promptPath: string; resultPath: string | null; guidancePaths: string[];
  dependencyAttemptIds: string[]; dependencyEvidence?: DependencyEvidence[]; stopped: boolean; acceptedForRevision?: number;
}
export interface PreviewRef {
  nodeId: string; specDigest: string; graphDigest: string;
  contentPath: string; generatedBy: string; current: boolean;
  images?: {artifactPath:string;caption:string}[];
}
export interface ActionRecord {
  id: string; kind: string; baseRevision: number;
  phase: "queued" | "claimed" | "applied" | "failed" | "unknown";
  actor: string; nodeId: string | null; requestId: string | null;
  receiptPath: string | null; error: string | null;
  payload: unknown;
}
export interface BoardMessage { id: string; author: string; body: string; createdAt: string; nativeMessageId?: string; componentNodeId?: string; answered?: boolean }
export interface BoardSnapshot {
  collection: CollectionState;
  version: 1; id: string; title: string; revision: number; deliveryId: string;
  members: MemberRef[]; coordinatorIdentity: string;
  nodes: BoardNode[]; edges: BoardEdge[]; attempts: AttemptRef[]; components: Record<string, ComponentState>;
  specApproval: { nodeRevision: number; digest: string } | null;
  preview: PreviewRef | null; pausedNodeIds: string[];
  pauseNewStarts: boolean; actions: ActionRecord[];
  discussionGroupId: string | null; implementationRunId: string | null;
  messages: BoardMessage[]; acceptedGraphDigest: string | null;
  acceptedNodeDigests: Record<string,string>;
  history: { deliveryId: string; snapshotPath: string }[];
  observationError?: string;
  discussionStatus?: {status:string;cycle:number;round:number;remainingRounds:number;remainingSeconds:number;outstanding:number};
}
export interface FileEdit { path: string; baseDigest: string | null; content: string | null }
export type BoardEdit =
  | { kind: "component-start" | "component-guidance" | "component-stop" | "component-reconcile" | "component-question"; nodeId: string; body: string; messageId?: string }
  | { kind: "new-delivery" }
  | { kind: "reconcile"; targetActionId: string }
  | { kind: "accept-result"; nodeId: string; attemptId: string }
  | { kind: "remove-selection"; nodeIds: string[]; edgeIds: string[] }
  | { kind: "add-task"; title: string }
  | { kind: "edit-node"; nodeId: string; title: string; content: NodeContent; assignment: Assignment | null; collaborate?: ComponentBinding }
  | { kind: "move-node"; nodeId: string; position: { x: number; y: number } }
  | { kind: "connect"; source: string; target: string }
  | { kind: "disconnect"; edgeId: string }
  | { kind: "remove-node"; nodeId: string }
  | { kind: "approve-spec" }
  | { kind: "pause" | "resume"; nodeIds?: string[] }
  | { kind: "start" }
  | { kind: "members"; members: MemberRef[]; coordinatorIdentity: string }
  | { kind: "discuss" | "generate-tasks" | "review-graph"; body: string }
  | { kind: "guidance" | "stop-rerun"; nodeId: string; body: string }
  | { kind: "answer-question"; messageId: string; body: string };

export function createBoardNode(id: string, kind: NodeKind, title: string): BoardNode {
  return { id, kind, title, revision: 1, content: { prompt: "", plan: "", design: "", implementationNotes: "" }, assignment: null, position: { x: 100, y: 100 }, removed: false };
}
export function createBoardSnapshot(id: string, title: string, members: MemberRef[], coordinatorIdentity: string): BoardSnapshot {
  return { collection: emptyCollection(), version: 1, id, title, revision: 1, deliveryId: `${id}-delivery-1`, members, coordinatorIdentity,
    nodes: [createBoardNode(`${id}-run`, "run", "Run")], edges: [], attempts: [], components: {}, specApproval: null,
    preview: null, pausedNodeIds: [], pauseNewStarts: true, actions: [], discussionGroupId: null,
    implementationRunId: null, messages: [], acceptedGraphDigest: null, acceptedNodeDigests: {}, history: [] };
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function assertText(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${name} must be text`);
}
export function validateMembers(value: unknown): asserts value is MemberRef[] {
  if (!Array.isArray(value)) throw new Error("members must be an array");
  const identities = new Set<string>();
  for (const member of value) {
    if (!isRecord(member)) throw new Error("Invalid member");
    for (const field of ["identity", "source", "sessionId", "tabId", "tabName", "terminalHandle", "incarnationId", "hostId", "workspacePath"]) assertText(member[field], field);
    if (!["codex", "claude", "cursor", "other"].includes(String(member.source)) || member.identity !== `${member.source}:${member.sessionId}` || !member.sessionId || !member.terminalHandle || !member.incarnationId || !member.hostId || !member.workspacePath) throw new Error("Unverified member identity");
    if (identities.has(String(member.identity))) throw new Error("Duplicate member identity");
    identities.add(String(member.identity));
  }
}
export function validateContent(value: unknown): asserts value is NodeContent {
  if (!isRecord(value)) throw new Error("Invalid node content");
  for (const field of ["prompt", "plan", "design", "implementationNotes"]) assertText(value[field], field);
}
export function validateAssignment(value: unknown): asserts value is Assignment | null {
  if (value === null) return;
  if (!isRecord(value)) throw new Error("Invalid assignment");
  if (value.kind === "member") { assertText(value.identity, "identity"); return; }
  if (value.kind !== "new-worker") throw new Error("Invalid assignment kind");
  assertText(value.agent, "agent"); assertText(value.workspacePath, "workspacePath");
  if (!value.agent || !value.workspacePath.startsWith("/")) throw new Error("Agent and absolute workspace required");
  if (value.model !== undefined) assertText(value.model, "model");
  if (value.effort !== undefined) { assertText(value.effort, "effort"); if (!value.model) throw new Error("Effort requires model"); }
}
