import {emptyCollection} from '../../shared/imports.js';
import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile, rename, readdir, unlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBoardSnapshot, validateMembers, isRecord, type BoardSnapshot, type MemberRef } from "../../shared/board.js";
import { validateGraph, digestExecutableBoard, digestSpec } from "./boardGraph.js";

export class BoardConflict extends Error {
  constructor(public readonly currentRevision: number) { super(`Board revision conflict; current revision is ${currentRevision}`); }
}
interface StoredBoard { snapshot: BoardSnapshot; receipts: Record<string, {revision:number}>; createActionId: string }
export interface BoardStore {
  root: string;
  create(input: {title: string; members: MemberRef[]; coordinatorIdentity: string}, actionId: string): Promise<BoardSnapshot>;
  read(id: string): Promise<BoardSnapshot>;
  list(): Promise<BoardSnapshot[]>;
  update(id: string, expectedRevision: number, actionId: string, mutation: (board: BoardSnapshot) => BoardSnapshot): Promise<BoardSnapshot>;
  artifact(id: string, name: string, value: string): Promise<string>;
  readArtifact(id: string, name: string): Promise<string>;
  close(): Promise<void>;
}
export function validateStorageId(id: string): void {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error("Invalid storage ID");
}
async function writeAtomic(path: string, value: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
}
export async function createBoardStore(root: string): Promise<BoardStore> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  root = await realpath(root);
  const lock = join(tmpdir(), `orca-board-writer-${createHash("sha256").update(root).digest("hex")}.lock`);
  try { await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(lock, "utf8"));
    try { process.kill(pid, 0); } catch (signalError) {
      if ((signalError as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("Cannot verify existing board writer");
      await unlink(lock);
      return createBoardStore(root);
    }
    throw new Error("Another board store writer is active");
  }
  let closed = false;
  const queues = new Map<string, Promise<unknown>>();
  function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("Board writer is closed"));
    const result = (queues.get(key) ?? Promise.resolve()).catch(()=>{}).then(operation);
    queues.set(key, result);
    result.finally(()=>{ if (queues.get(key) === result) queues.delete(key); }).catch(()=>{});
    return result;
  }
  function path(id: string): string { validateStorageId(id); return join(root, id, "board.json"); }
  async function stored(id: string): Promise<StoredBoard> {
    const value = JSON.parse(await readFile(path(id), "utf8")) as StoredBoard;
    if (value.snapshot?.version !== 1 || value.snapshot.id !== id) throw new Error("Unsupported board storage version");
    value.snapshot.acceptedNodeDigests ??= {};
    value.snapshot.components ??= {};
    value.snapshot.collection ??= emptyCollection();
    if(value.snapshot.preview)value.snapshot.preview.current=value.snapshot.preview.specDigest===digestSpec(value.snapshot) && value.snapshot.preview.graphDigest===digestExecutableBoard(value.snapshot);
    validateGraph(value.snapshot.nodes, value.snapshot.edges);
    return value;
  }
  async function list(): Promise<BoardSnapshot[]> {
    const dirs = await readdir(root, { withFileTypes: true });
    const boards: BoardSnapshot[] = [];
    for (const entry of dirs) if (entry.isDirectory() && entry.name.startsWith("board_")) {
      try { boards.push((await stored(entry.name)).snapshot); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return boards;
  }
  const store: BoardStore = {
    root, list,
    read: async id => structuredClone((await stored(id)).snapshot),
    create: (input, actionId) => serialize("create", async () => {
      validateStorageId(actionId);
      if (typeof input.title !== "string" || !input.title.trim()) throw new Error("Group title required");
      validateMembers(input.members);
      if (input.coordinatorIdentity && !input.members.some(member=>member.identity===input.coordinatorIdentity)) throw new Error("Coordinator must be a group member");
      for (const board of await list()) if ((await stored(board.id)).createActionId === actionId) return board;
      const id = `board_${randomUUID()}`;
      const snapshot = createBoardSnapshot(id, input.title, input.members, input.coordinatorIdentity);
      await mkdir(join(root,id,"artifacts"), {recursive:true,mode:0o700});
      await writeAtomic(path(id), JSON.stringify({ snapshot, receipts: {}, createActionId: actionId }));
      return structuredClone(snapshot);
    }),
    update: (id, expectedRevision, actionId, mutation) => serialize(id, async () => {
      validateStorageId(actionId);
      const value = await stored(id);
      if (Object.hasOwn(value.receipts, actionId)) return structuredClone(value.snapshot);
      if (value.snapshot.revision !== expectedRevision) throw new BoardConflict(value.snapshot.revision);
      const next = mutation(structuredClone(value.snapshot));
      if (next.id !== id || next.version !== 1) throw new Error("Board identity cannot change");
      validateGraph(next.nodes,next.edges); validateMembers(next.members);
      if (next.coordinatorIdentity && !next.members.some(member=>member.identity===next.coordinatorIdentity)) throw new Error("Coordinator must remain a member");
      next.revision = value.snapshot.revision + 1;
      if(next.preview)next.preview.current=next.preview.specDigest===digestSpec(next) && next.preview.graphDigest===digestExecutableBoard(next);
      if (digestExecutableBoard(next) !== digestExecutableBoard(value.snapshot)) {
        await writeAtomic(join(root,id,"artifacts",`revision-${value.snapshot.revision}.json`),JSON.stringify(value.snapshot));
      }
      value.snapshot = next;
      Object.defineProperty(value.receipts, actionId, {value:{revision:next.revision}, enumerable:true, configurable:true});
      await writeAtomic(path(id),JSON.stringify(value));
      return structuredClone(next);
    }),
    artifact: async (id,name,value) => {
      validateStorageId(id); validateStorageId(name);
      await stored(id);
      const destination = join(root,id,"artifacts",name);
      await writeFile(destination,value,{flag:"wx",mode:0o600});
      return name;
    },
    readArtifact: async (id,name) => { validateStorageId(id); validateStorageId(name); return readFile(join(root,id,"artifacts",name),"utf8"); },
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([...queues.values()]);
      await unlink(lock);
    },
  };
  for(const board of await store.list()){
    if(board.collection.requests.some(request=>request.delivery==='sending'))await store.update(board.id,board.revision,`collection-recover-${randomUUID()}`,current=>{for(const request of current.collection.requests)if(request.delivery==='sending')request.delivery='unknown';return current;});
    const interrupted=Object.values(board.components).flatMap(state=>state.launches.filter(launch=>launch.phase==='claimed'));
    if(interrupted.length)await store.update(board.id,(await store.read(board.id)).revision,`component-recover-${randomUUID()}`,current=>{for(const state of Object.values(current.components))for(const launch of state.launches)if(launch.phase==='claimed')launch.phase='unknown';return current;});

    const uncertain=board.actions.filter(action=>isRecord(action.payload) && ((action.phase==="queued" && action.payload.delivery==="sending") || (action.phase==="claimed" && (action.payload.operationToken || action.payload.effectToken || action.payload.membershipToken || action.kind==="apply-files"))));
    if(uncertain.length)await store.update(board.id,(await store.read(board.id)).revision,`recover-${randomUUID()}`,current=>{for(const action of current.actions)if(uncertain.some(item=>item.id===action.id)){action.phase="unknown";action.error="Server restarted with an unfinished effect; reconcile its receipt before retrying";}return current;});
  }
  return store;
}
