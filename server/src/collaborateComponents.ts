import { registerComponentRun, type ComponentAssociation } from "./componentRegistry.js";
import { resolveBoardDependencies } from "./boardDependencies.js";
import { readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BoardStore } from './boardStore.js';
import { isRecord, type BoardSnapshot, type MemberRef } from '../../shared/board.js';
import type { ApprovalSource, ComponentState, ComponentTask, GatePackage, ComponentLaunchRequest, ComponentLaunch } from '../../shared/collaborate.js';
import { digestValue, digestNodeInput, digestSpec } from './boardGraph.js';
import { verifyGroupMember } from './sessionDiscovery.js';
import { runOrca } from './orca.js';

const execute = promisify(execFile);
export interface CollaboratePorts {
  readManifest(path: string): Promise<{path: string; value: Record<string, unknown>}>;
  verifyMaster(member: MemberRef): Promise<MemberRef>;
  verifyFeature(path: string): Promise<void>;
  verifyRun(runId: string, terminalHandle: string): Promise<void>;
  registerBinding?(association:ComponentAssociation):Promise<void>;
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} required`);
  return value;
}
function textList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item=>typeof item !== 'string')) throw new Error(`${label} must be a text list`);
  return value;
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  return value;
}
export function digestComponentValue(value: unknown): string { return digestValue(stableValue(value)); }
export const collaboratePorts: CollaboratePorts = {
  async readManifest(path) {
    const root = await realpath(process.env.ORCA_COLLABORATE_ROOT ?? join(homedir(),'work-vault/sessions/collaborate'));
    const actual = await realpath(path), child = relative(root,actual);
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Manifest must be inside the collaborate artifact root');
    const text = await readFile(actual,'utf8');
    if (Buffer.byteLength(text)>4*1024*1024) throw new Error('Component manifest is too large');
    const value:unknown = JSON.parse(text);
    if (!isRecord(value)) throw new Error('Invalid component manifest');
    return {path:actual,value};
  },
  verifyMaster: verifyGroupMember,
  registerBinding: registerComponentRun,
  async verifyFeature(path) {
    const helper=process.env.ORCA_FEATURE_WORKTREE_HELPER;
    if (!helper) throw new Error('Configure the registered feature worktree helper');
    const {stdout}=await execute(process.env.ORCA_BOARD_PYTHON??'python3',[helper,'show','--worktree',path],{timeout:30000,maxBuffer:1024*1024});
    const record=JSON.parse(stdout);
    if (await realpath(record.worktree)!==await realpath(path)) throw new Error('Manifest feature registration does not match');
  },
  async verifyRun(runId, terminalHandle) {
    const result=await runOrca<{run:{id:string;coordinator_handle:string}}>(['orchestration','run-show','--id',runId]);
    if (result.run?.id!==runId || result.run.coordinator_handle!==terminalHandle) throw new Error('Component Run belongs to a different master');
  },
};
export function readGatePackage(manifest: Record<string,unknown>): GatePackage {
  if (!['feature','repair'].includes(String(manifest.delivery_scope))) throw new Error('Component delivery scope required');
  if (typeof manifest.feature_close_requested !== 'boolean') throw new Error('Feature-close scope required');
  if (!isRecord(manifest.repair_policy)) throw new Error('Component repair policy required');
  const commands=textList(manifest.gate_commands,'Gate commands');
  if (!commands.length) throw new Error('Concrete gate commands required');
  return {baselineSha:requiredText(manifest.baseline_sha,'Baseline'),overlayDigest:requiredText(manifest.gate_revision,'Gate revision'),commands,
    setup:manifest.setup??{},humanChecks:textList(manifest.human_checks,'Human checks'),selectionPolicy:textList(manifest.selection_policy,'Selection policy'),
    deliveryScope:String(manifest.delivery_scope),featureCloseRequested:manifest.feature_close_requested,repairPolicy:manifest.repair_policy};
}
export function projectComponentTasks(manifest: Record<string,unknown>): ComponentTask[] {
  const tasks=isRecord(manifest.tasks)?manifest.tasks:{};
  const lifecycle=isRecord(manifest.lifecycle)?manifest.lifecycle:{};
  const dispatches=isRecord(lifecycle.dispatches)?lifecycle.dispatches:{};
  const textOrNull=(value:unknown)=>typeof value==='string'?value:null;
  return Object.entries(tasks).map(([taskId,value])=>{
    if(!isRecord(value))throw new Error(`Invalid component Task ${taskId}`);
    const dispatch=typeof value.dispatch_id==='string'?dispatches[value.dispatch_id]:null;
    return {taskId,kind:requiredText(value.kind,'Task kind'),candidateId:textOrNull(value.candidate_id),dispatchId:textOrNull(value.dispatch_id),terminalHandle:textOrNull(value.terminal_handle),
      state:isRecord(dispatch)&&typeof dispatch.state==='string'?dispatch.state:String(value.phase??'planned'),reportPath:textOrNull(value.report_archive??value.report),briefPath:textOrNull(value.brief)};
  });
}
export function componentGateDigest(board: BoardSnapshot, nodeId: string, manifestPath: string, gate: GatePackage): string {
  const node=board.nodes.find(node=>node.id===nodeId && !node.removed);
  if (!node?.collaborate) throw new Error('Collaborate component required');
  return digestComponentValue({deliveryId:board.deliveryId,nodeId,nodeRevision:node.revision,binding:node.collaborate,manifestPath,gate});
}
export function createCollaborateComponents(store: BoardStore, ports: CollaboratePorts=collaboratePorts) {
  async function inspect(board: BoardSnapshot, nodeId: string, identity: string) {
    const node=board.nodes.find(node=>node.id===nodeId && !node.removed);
    if (!node?.collaborate || node.collaborate.masterIdentity!==identity) throw new Error('Only this component master may publish its evidence');
    const master=board.members.find(member=>member.identity===identity);
    if (!master) throw new Error('Component master is no longer a member');
    await ports.verifyMaster(master);
    const manifest=await ports.readManifest(node.collaborate.manifestPath);
    const runId=requiredText(manifest.value.orca_run_id,'Component Run');
    const featureWorkspace=requiredText(manifest.value.feature_worktree,'Feature workspace');
    if (featureWorkspace!==master.workspacePath) throw new Error('Component feature workspace does not match its master');
    await ports.verifyFeature(featureWorkspace);
    await ports.verifyRun(runId,master.terminalHandle);
    const gate=readGatePackage(manifest.value);
    const prior=board.components[nodeId];
    if (prior && (prior.runId!==runId || prior.manifestPath!==manifest.path || prior.masterIdentity!==identity)) throw new Error('Component identity changed; reconcile its existing delivery before rebinding');
    const state:ComponentState={masterIdentity:identity,manifestPath:manifest.path,manifestDigest:digestComponentValue(manifest.value),runId,featureWorkspace,
      phase:typeof manifest.value.phase==='string'?manifest.value.phase:'planning',gate,gateDigest:componentGateDigest(board,nodeId,manifest.path,gate),
      approvals:prior?.approvals??[],launches:prior?.launches??[],result:prior?.result??null,tasks:projectComponentTasks(manifest.value),observedAt:new Date().toISOString()};
    const lifecycle=isRecord(manifest.value.lifecycle)?manifest.value.lifecycle:{};
    const dispatches=isRecord(lifecycle.dispatches)?lifecycle.dispatches:{};
    for(const launch of state.launches){
      const worker=launch.dispatchId?dispatches[launch.dispatchId]:null;
      if(isRecord(worker) && ['released','report_received'].includes(String(worker.state)))launch.phase='settled';
    }
    return {state,manifest:manifest.value,node};
  }
  async function checkLaunch(board:BoardSnapshot,nodeId:string,request:ComponentLaunchRequest) {
    for(const key of ['identity','launchId','taskId','role','journalPath'] as const)requiredText(request[key],key);
    if(!isAbsolute(request.journalPath))throw new Error('Absolute launch journal path required');
    const inspected=await inspect(board,nodeId,request.identity);
    const {state,node,manifest}=inspected;
    if(board.pauseNewStarts || board.pausedNodeIds.includes(nodeId))throw new Error('Component starts are paused');
    if(!board.specApproval || board.specApproval.digest!==digestSpec(board) || board.acceptedNodeDigests[nodeId]!==digestNodeInput(board,nodeId))throw new Error('Current specification and component revision approval required');
    if(!state.approvals.some(approval=>approval.digest===state.gateDigest))throw new Error('Current component gate approval required');
    const task=isRecord(manifest.tasks)?manifest.tasks[request.taskId]:null;
    const allowed:Record<string,string[]>={implementer:['implementation','repair'],reviewer:['review','closure'],clean_context:['clean_context']};
    if(!isRecord(task) || !allowed[request.role]?.includes(String(task.kind)))throw new Error('Launch role does not match the component manifest Task');
    if((task.candidate_id??null)!==request.candidateId)throw new Error('Launch candidate does not match its manifest Task');
    const dependencies=resolveBoardDependencies(board,nodeId);
    const requestDigest=digestComponentValue(request);
    const existing=state.launches.find(launch=>launch.request.launchId===request.launchId);
    if(state.launches.some(launch=>launch.request.taskId===request.taskId && launch.request.launchId!==request.launchId && launch.phase!=='settled'))throw new Error('Task already has a prepared or active launch; reconcile its existing journal');
    if(existing && (existing.requestDigest!==requestDigest || existing.nodeRevision!==node.revision || existing.gateDigest!==state.gateDigest || digestComponentValue(existing.dependencies)!==digestComponentValue(dependencies)))throw new Error('Launch inputs changed; reconcile the existing journal before replacement');
    return {...inspected,dependencies,requestDigest,existing};
  }
  return {
    async preflight(boardId:string,nodeId:string,request:ComponentLaunchRequest):Promise<ComponentLaunch>{
      const board=await store.read(boardId),checked=await checkLaunch(board,nodeId,request);
      if(checked.existing)return checked.existing;
      const launch:ComponentLaunch={request,requestDigest:checked.requestDigest,nodeRevision:checked.node.revision,gateDigest:checked.state.gateDigest,phase:'prepared',requestId:null,dispatchId:null,receiptPath:null,dependencies:checked.dependencies};
      const saved=await store.update(boardId,board.revision,`component-prepare-${request.launchId}`,current=>{checked.state.launches.push(launch);current.components[nodeId]=checked.state;return current;});
      return saved.components[nodeId].launches.find(item=>item.request.launchId===request.launchId)!;
    },
    async beginLaunch(boardId:string,nodeId:string,request:ComponentLaunchRequest):Promise<ComponentLaunch>{
      const board=await store.read(boardId),checked=await checkLaunch(board,nodeId,request);
      if(!checked.existing || checked.existing.phase!=='prepared')throw new Error('Launch already admitted or not prepared; reconcile its original journal');
      const saved=await store.update(boardId,board.revision,`component-begin-${request.launchId}`,current=>{checked.existing!.phase='claimed';current.components[nodeId]=checked.state;return current;});
      return saved.components[nodeId].launches.find(item=>item.request.launchId===request.launchId)!;
    },
    async recordLaunch(boardId:string,nodeId:string,request:ComponentLaunchRequest,receipt:unknown):Promise<BoardSnapshot>{
      const board=await store.read(boardId),state=board.components[nodeId];
      if(!state || state.masterIdentity!==request.identity)throw new Error('Component master required');
      await ports.verifyMaster(board.members.find(member=>member.identity===request.identity)!);
      const launch=state.launches.find(item=>item.request.launchId===request.launchId);
      if(!launch || launch.requestDigest!==digestComponentValue(request) || launch.phase==='prepared')throw new Error('An admitted matching launch is required');
      const wrapper=isRecord(receipt)?receipt:{};
      const raw=isRecord(wrapper.receipt)?wrapper.receipt:wrapper;
      const result=isRecord(raw.result)?raw.result:{};
      if((result.runId && result.runId!==state.runId) || (result.taskId && result.taskId!==request.taskId))throw new Error('Native launch receipt belongs to another Run or Task');
      if(launch.dispatchId && result.dispatchId && launch.dispatchId!==result.dispatchId)throw new Error('Conflicting native Dispatch receipt; preserve the existing launch identity');
      const receiptPath=await store.artifact(boardId,`component-receipt-${randomUUID()}`,JSON.stringify(raw));
      return store.update(boardId,board.revision,`component-receipt-${request.launchId}-${digestComponentValue(receipt)}`,current=>{
        const saved=current.components[nodeId].launches.find(item=>item.request.launchId===request.launchId)!;
        const mutation=isRecord(result.mutation)?result.mutation:{};
        const error=isRecord(raw.error)?raw.error:{};const details=isRecord(error.data)?error.data:{};
        const requestId=mutation.requestId??details.orchestrationRequestId??details.requestId;
        saved.requestId=typeof requestId==='string'?requestId:saved.requestId;
        saved.dispatchId=typeof result.dispatchId==='string'?result.dispatchId:saved.dispatchId;
        saved.phase=raw.ok===true && result.state==='ready' && saved.dispatchId?'ready':raw.ok===false && result.state==='failed'?'failed':'unknown';
        saved.receiptPath=receiptPath;return current;
      });
    },
    async refresh(boardId:string,nodeId:string,identity:string,actionId:string):Promise<BoardSnapshot>{
      const board=await store.read(boardId),{state}=await inspect(board,nodeId,identity);
      await ports.registerBinding?.({boardId,nodeId,runId:state.runId,masterIdentity:identity,terminalHandle:board.members.find(member=>member.identity===identity)!.terminalHandle,manifestPath:state.manifestPath,url:process.env.ORCA_BOARD_URL??`http://127.0.0.1:${process.env.PORT??8787}`});
      return store.update(boardId,board.revision,actionId,current=>{current.components[nodeId]=state;return current;});
    },
    currentApproval(board:BoardSnapshot,nodeId:string) {
      const state=board.components[nodeId];
      if(!state || state.gateDigest!==componentGateDigest(board,nodeId,state.manifestPath,state.gate))return null;
      return state.approvals.filter(approval=>approval.digest===state.gateDigest).at(-1)??null;
    },
    async approve(boardId:string,nodeId:string,digest:string,source:ApprovalSource,actionId:string):Promise<BoardSnapshot>{
      const board=await store.read(boardId),node=board.nodes.find(node=>node.id===nodeId);
      if(!node?.collaborate)throw new Error('Collaborate component required');
      if(!source || !['ui','chat'].includes(source.kind) || !source.reference?.trim() || !source.response?.trim())throw new Error('Actual human approval provenance required');
      const {state}=await inspect(board,nodeId,node.collaborate.masterIdentity);
      if(state.gateDigest!==digest)throw new Error('Gate package changed; review its current revision');
      const existing=board.actions.find(action=>action.id===actionId);
      if(existing){if(existing.kind!=='approve-component-gate' || !isRecord(existing.payload) || existing.payload.digest!==digest)throw new Error('Approval action belongs to other inputs');return board;}
      const artifactPath=await store.artifact(boardId,`gate-approval-${randomUUID()}`,JSON.stringify({gate:state.gate,digest,source,nodeId,nodeRevision:node.revision,deliveryId:board.deliveryId}));
      return store.update(boardId,board.revision,actionId,current=>{
        if(!state.approvals.some(approval=>approval.digest===digest))state.approvals.push({digest,nodeRevision:node.revision,deliveryId:board.deliveryId,source,artifactPath,recordedAt:new Date().toISOString()});current.components[nodeId]=state;
        current.actions.push({id:actionId,kind:'approve-component-gate',baseRevision:board.revision,phase:'applied',actor:'human',nodeId,requestId:null,receiptPath:artifactPath,error:null,payload:{digest,source}});return current;
      });
    },
  };
}
