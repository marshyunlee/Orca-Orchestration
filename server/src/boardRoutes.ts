import {createImportControls,hasImportedWork} from './importControls.js';
import {createImportRouter,collectBoardSessions} from './importRoutes.js';
import { componentActionKinds } from "./componentPrompt.js";
import { hasComponentWork } from "./componentActivity.js";
import { createCollaborateRouter } from "./collaborateRoutes.js";
import { validateComponentBinding } from "../../shared/collaborate.js";
import {observationErrors,discussionStatuses} from "./nativeObservation.js";
import {createMembershipActions} from "./membershipActions.js";
import {createWorkspaceRouter} from "./workspaceRoutes.js";
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { createBoardNode, isRecord, validateContent, validateAssignment, validateMembers, type BoardSnapshot, type BoardEdit } from "../../shared/board.js";
import { BoardConflict, type BoardStore } from "./boardStore.js";
import { findDownstream, digestSpec, digestValue } from "./boardGraph.js";
import { createActionExecutor } from "./interventions.js";
import { createExecutionBridge, hasActiveWriter } from "./executionBridge.js";
import { createCoordinatorActions, type CoordinatorProposal } from "./coordinatorActions.js";
import { digestExecutableBoard } from "./boardGraph.js";
import { verifyGroupMember } from "./sessionDiscovery.js";
import { requireToken } from "./localAuth.js";

export function applyBoardEdit(board: BoardSnapshot, operation: BoardEdit): BoardSnapshot {
  if (!isRecord(operation)) throw new Error("Operation required");
  const target = "nodeId" in operation ? board.nodes.find(node=>node.id===operation.nodeId && !node.removed) : undefined;
  if ("nodeId" in operation && !target) throw new Error("Node not found");
  switch (operation.kind) {
    case "resolve-import": {
      if(!target!.imported || !Array.isArray(operation.fields))throw new Error("Imported proposal required");
      for(const field of operation.fields){
        if(!['title','prompt','plan','design','implementationNotes'].includes(field))throw new Error("Unknown source field");
        const key=field as "title"|"prompt"|"plan"|"design"|"implementationNotes";
        const value=target!.imported.proposals[key];if(value===undefined)continue;
        if(operation.accept){if(key==='title')target!.title=value;else target!.content[key]=value;}
        delete target!.imported.proposals[key];
      }
      target!.revision++;return board;
    }
    case "accept-result": {
      const attempt=board.attempts.find(attempt=>attempt.id===operation.attemptId && attempt.nodeId===target!.id);
      if(!attempt || attempt.nativeStatus!=="completed" || !attempt.resultPath)throw new Error("A completed attempt with result evidence is required");
      attempt.acceptedForRevision=target!.revision;return board;
    }
    case "remove-selection": {
      if(!Array.isArray(operation.nodeIds) || !Array.isArray(operation.edgeIds))throw new Error("Selection required");
      for(const nodeId of operation.nodeIds)applyBoardEdit(board,{kind:"remove-node",nodeId});
      for(const edge of board.edges)if(operation.edgeIds.includes(edge.id) && edge.importedKey)board.collection.suppressedEdges.push(edge.importedKey);
      board.edges=board.edges.filter(edge=>!operation.edgeIds.includes(edge.id));return board;
    }
    case "add-task": {
      if (typeof operation.title !== "string" || !operation.title.trim()) throw new Error("Task title required");
      const node = createBoardNode(`node_${randomUUID()}`,"task",operation.title);
      node.position={x:400,y:100+board.nodes.filter(node=>!node.removed).length*130};
      board.nodes.push(node);
      board.edges.push({id:`edge_${randomUUID()}`,source:board.nodes.find(node=>node.kind==="run")!.id,target:node.id});
      return board;
    }
    case "move-node":
      if (!Number.isFinite(operation.position?.x) || !Number.isFinite(operation.position?.y)) throw new Error("Invalid position");
      target!.position=operation.position; return board;
    case "edit-node": {
      validateContent(operation.content); validateAssignment(operation.assignment); validateComponentBinding(operation.collaborate);
      if (operation.collaborate && !board.members.some(member=>member.identity===operation.collaborate!.masterIdentity)) throw new Error("Component master must be a group member");
      if (typeof operation.title !== "string" || !operation.title.trim()) throw new Error("Title required");
      if (target!.kind === "preview") throw new Error("Update Preview through graph review");
      const assignment=operation.assignment;
      if (assignment?.kind === "member" && !board.members.some(member=>member.identity===assignment.identity)) throw new Error("Assigned session is not a member");
      if (JSON.stringify([target!.title,target!.content,target!.assignment,target!.collaborate]) === JSON.stringify([operation.title,operation.content,operation.assignment,operation.collaborate])) return board;
      if(hasComponentWork(board,target!.id) && JSON.stringify(target!.collaborate)!==JSON.stringify(operation.collaborate))throw new Error("Settle component work before changing its execution binding");
      target!.title=operation.title; target!.content=operation.content; target!.assignment=operation.assignment; target!.collaborate=operation.collaborate; target!.revision++;
      if (target!.kind === "run") board.specApproval=null;
      if (hasImportedWork(board,target!.id) || hasComponentWork(board,target!.id) || board.attempts.some(attempt=>attempt.nodeId===target!.id && hasActiveWriter(attempt))) {
        board.pausedNodeIds=[...new Set([...board.pausedNodeIds,...findDownstream(target!.id,board.edges)])];
      }
      return board;
    }
    case "connect":
      if (typeof operation.source!=="string" || typeof operation.target!=="string") throw new Error("Edge endpoints required");
      if (board.edges.some(edge=>edge.source===operation.source && edge.target===operation.target)) return board;
      board.edges.push({id:`edge_${randomUUID()}`,source:operation.source,target:operation.target}); return board;
    case "disconnect": {
      if (!board.edges.some(edge=>edge.id===operation.edgeId)) throw new Error("Edge not found");
      const removed=board.edges.find(edge=>edge.id===operation.edgeId);if(removed?.importedKey)board.collection.suppressedEdges.push(removed.importedKey);
      board.edges=board.edges.filter(edge=>edge.id!==operation.edgeId); return board;
    }
    case "remove-node":
      if (target!.kind!=="task") throw new Error("Only task nodes can be removed");
      if (hasImportedWork(board,target!.id) || hasComponentWork(board,target!.id) || board.attempts.some(attempt=>attempt.nodeId===target!.id && hasActiveWriter(attempt))) throw new Error("Stop active work before removing this task");
      board.pausedNodeIds=[...new Set([...board.pausedNodeIds,...findDownstream(target!.id,board.edges)])];
      target!.removed=true;
      board.edges=board.edges.filter(edge=>edge.source!==target!.id && edge.target!==target!.id); return board;
    case "members": {
      validateMembers(operation.members);
      if (!operation.members.some(member=>member.identity===operation.coordinatorIdentity)) throw new Error("Coordinator must be a member");
      const changed=board.members.filter(member=>!operation.members.some(candidate=>candidate.identity===member.identity && candidate.terminalHandle===member.terminalHandle && candidate.incarnationId===member.incarnationId));
      if(changed.some(member=>board.nodes.some(node=>node.imported?.ownerIdentity===member.identity && hasImportedWork(board,node.id))))throw new Error("Settle owner work and control actions before removing its session");
      if (changed.some(member=>board.nodes.some(node=>node.collaborate?.masterIdentity===member.identity && hasComponentWork(board,node.id))) || board.attempts.some(attempt=>changed.some(member=>member.terminalHandle===attempt.assigneeHandle) && hasActiveWriter(attempt))) throw new Error("Settle outstanding work before removing or rebinding its member");
      if (board.discussionGroupId) throw new Error("Membership must be reconciled by the group coordinator");
      board.members=operation.members;board.coordinatorIdentity=operation.coordinatorIdentity;return board;
    }
    case "approve-spec": {
      const root=board.nodes.find(node=>node.kind==="run")!;
      if (!root.content.design.trim()) throw new Error("A specification is required before approval");
      board.specApproval={nodeRevision:root.revision,digest:digestSpec(board)}; return board;
    }
    case "pause":
      if (operation.nodeIds) {
        if (!Array.isArray(operation.nodeIds) || operation.nodeIds.some(id=>!board.nodes.some(node=>node.id===id))) throw new Error("Unknown pause scope");
        board.pausedNodeIds=[...new Set([...board.pausedNodeIds,...operation.nodeIds])];
      } else board.pauseNewStarts=true;
      return board;
    case "resume":
      if (!board.acceptedGraphDigest) throw new Error("Start the reviewed board before resuming");
      board.pauseNewStarts=false;
      board.pausedNodeIds=operation.nodeIds ? board.pausedNodeIds.filter(id=>!operation.nodeIds!.includes(id)) : []; return board;
    default: throw new Error("Unsupported board edit");
  }
}

export function sendBoardError(response: Response, error: unknown): void {
  if (error instanceof BoardConflict) response.status(409).json({error:error.message,currentRevision:error.currentRevision});
  else response.status((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400).json({error:String((error as Error).message ?? error)});
}
export function createBoardRouter(store: BoardStore, token: string): Router {
  const router=Router();
  const coordinator=createCoordinatorActions(store);
  const bridge=createExecutionBridge(store);
  const executor=createActionExecutor(store);
  const membership=createMembershipActions(store);
  const imports=createImportControls(store);
  async function queueOwnerScope(board:BoardSnapshot,control:string,actionId:string,nodeIds?:string[]):Promise<BoardSnapshot>{
    let current=board;const queued:string[]=[];
    for(const node of board.nodes.filter(node=>!node.removed && node.imported && node.imported.status!=="completed" && (!nodeIds || nodeIds.includes(node.id)))){
      if(!board.members.some(member=>member.identity===node.imported!.ownerIdentity && member.terminalHandle===node.imported!.ownerHandle))continue;
      const ownerAction=`scope-${digestValue([actionId,node.id])}`;
      current=await imports.queue(current.id,current.revision,ownerAction,node.id,control,`Human requested ${control} for this board scope.`);
      queued.push(ownerAction);
    }
    for(const id of queued)void coordinator.deliver(current.id,id).catch(()=>{});
    return current;
  }
  router.get("/",async (_request,response)=>{try{response.json({boards:(await store.list()).map(board=>({...board,observationError:observationErrors.get(board.id),discussionStatus:discussionStatuses.get(board.id)}))});}catch(error){sendBoardError(response,error);}});
  router.get("/:id",async (request,response)=>{try{const board=await store.read(request.params.id);response.json({...board,digests:{spec:digestSpec(board),graph:digestExecutableBoard(board)}});}catch(error){sendBoardError(response,error);}});
  router.use(requireToken(token));
  router.use("/:id/files",createWorkspaceRouter(store));
  router.use("/:id/collection",createImportRouter(store));
  router.use("/:id/components",createCollaborateRouter(store));
  router.post("/",async (request,response)=>{
    try {
      validateMembers(request.body.members);
      request.body.members=await Promise.all(request.body.members.map(verifyGroupMember));
      if(request.body.members.length && !request.body.coordinatorIdentity)throw new Error("Select a coordinator for the existing sessions");
      let board=await store.create(request.body,request.body.actionId);
      if(typeof request.body.prompt==='string')board=await store.update(board.id,board.revision,`${request.body.actionId}-root`,current=>{current.nodes.find(node=>node.kind==='run')!.content.prompt=request.body.prompt;return current;});
      response.json(board);
      if(board.members.length)void collectBoardSessions(store,board.id).catch(()=>{});
    } catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/edit",async (request: Request,response: Response)=>{
    try {
      if (!isRecord(request.body) || !Number.isInteger(request.body.baseRevision)) throw new Error("Base revision required");
      const {baseRevision,actionId,operation}=request.body;
      if(isRecord(operation) && operation.kind==='import-control'){
        const saved=await imports.queue(String(request.params.id),baseRevision as number,String(actionId),String(operation.nodeId),String(operation.control),String(operation.body??''),typeof operation.messageId==='string'?operation.messageId:undefined);response.json(saved);void coordinator.deliver(saved.id,String(actionId)).catch(()=>{});return;
      }
      if(isRecord(operation) && operation.kind==="new-delivery"){
        const current=await store.read(String(request.params.id));
        if(current.nodes.some(node=>hasImportedWork(current,node.id) || hasComponentWork(current,node.id)) || current.attempts.some(hasActiveWriter) || current.actions.some(action=>["claimed","unknown"].includes(action.phase)))throw new Error("Reconcile active work before starting a new increment");
        const path=await store.artifact(current.id,`delivery-${randomUUID()}`,JSON.stringify(current));
        response.json(await store.update(current.id,baseRevision as number,actionId as string,board=>{
          board.history.push({deliveryId:board.deliveryId,snapshotPath:path});board.deliveryId=`delivery_${randomUUID()}`;
          board.nodes=board.nodes.filter(node=>node.kind==="run");board.collection.suppressedEdges=[];board.edges=[];board.attempts=[];board.components={};board.actions=[];board.preview=null;board.pausedNodeIds=[];board.pauseNewStarts=true;board.acceptedGraphDigest=null;board.acceptedNodeDigests={};board.implementationRunId=null;return board;
        }));return;
      }
      if (isRecord(operation) && [...componentActionKinds,"discuss","generate-tasks","review-graph","answer-question","start","resume","guidance","stop-rerun","reconcile"].includes(String(operation.kind))) {
        let saved=await coordinator.queue(String(request.params.id),baseRevision as number,actionId as string,String(operation.kind),String(operation.body??""),operation);
        if(operation.kind==='resume')saved=await queueOwnerScope(saved,'resume',String(actionId),Array.isArray(operation.nodeIds)?operation.nodeIds as string[]:undefined);
        response.json(saved);
        void coordinator.deliver(saved.id,actionId as string).catch(()=>{});
        return;
      }
      if (isRecord(operation) && operation.kind === "members") {
        validateMembers(operation.members);
        operation.members=await Promise.all(operation.members.map(verifyGroupMember));
        const current=await store.read(String(request.params.id));
        if(current.discussionGroupId){
          const saved=await coordinator.queue(current.id,baseRevision as number,actionId as string,"members","Update the selected group sessions and coordinator.",operation);
          response.json(saved);void coordinator.deliver(saved.id,actionId as string).catch(()=>{});return;
        }
      }
      let saved=await store.update(String(request.params.id),baseRevision as number,actionId as string,board=>applyBoardEdit(board,operation as BoardEdit));
      if(isRecord(operation) && operation.kind==="pause")saved=await queueOwnerScope(saved,"pause",String(actionId),Array.isArray(operation.nodeIds)?operation.nodeIds as string[]:undefined);
      response.json(saved);
      if(isRecord(operation) && operation.kind==="members")void collectBoardSessions(store,saved.id).catch(()=>{});
    } catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/coordinator/launch",async(request,response)=>{
    try{
      const board=await store.read(request.params.id);
      if(request.body.identity!==board.coordinatorIdentity)throw new Error("Selected coordinator required");
      await verifyGroupMember(board.members.find(member=>member.identity===board.coordinatorIdentity)!);
      response.json(await bridge.admitLaunch(board.id,request.body.nodeId,request.body.nodeRevision,request.body.actionId));
    }catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/coordinator/operation",async(request,response)=>{
    try{
      const board=await store.read(request.params.id);
      if(request.body.identity!==board.coordinatorIdentity)throw new Error("Selected coordinator required");
      response.json(await bridge.beginOperation(board.id,request.body.actionId));
    }catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/coordinator/receipt",async(request,response)=>{
    try{
      const board=await store.read(request.params.id);
      if(request.body.identity!==board.coordinatorIdentity)throw new Error("Selected coordinator required");
      response.json(await bridge.recordNativeReceipt(board.id,request.body.actionId,request.body.token,request.body.receipt));
    }catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/coordinator/action-operation",async(request,response)=>{
    try{response.json(await executor.begin(request.params.id,request.body.actionId,request.body.identity));}catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/coordinator/action-receipt",async(request,response)=>{
    try{
      const board=await store.read(request.params.id);
      if(request.body.identity!==board.coordinatorIdentity)throw new Error("Selected coordinator required");
      response.json(await executor.finish(board.id,request.body.actionId,request.body.token,request.body.receipt));
    }catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/member/stopped",async(request,response)=>{
    try{
      const board=await store.read(request.params.id);
      const member=board.members.find(member=>member.identity===request.body.identity);
      if(!member)throw new Error("Member binding required");await verifyGroupMember(member);
      response.json(await executor.attestStopped(board.id,request.body.attemptId,member.identity,request.body.evidence));
    }catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/coordinator/membership-operation",async(request,response)=>{try{response.json(await membership.begin(request.params.id,request.body.actionId,request.body.identity));}catch(error){sendBoardError(response,error);}});
  router.post("/:id/coordinator/membership-receipt",async(request,response)=>{try{response.json(await membership.finish(request.params.id,request.body.actionId,request.body.identity,request.body.token,request.body.receipt));}catch(error){sendBoardError(response,error);}});
  router.post("/:id/coordinator/claim",async(request,response)=>{
    try{response.json(await coordinator.claim(request.params.id,request.body.actionId,request.body.identity));}catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/coordinator/publish",async(request,response)=>{
    try{response.json(await coordinator.publish(request.params.id,request.body.baseRevision,request.body.actionId,request.body.identity,request.body.proposal as CoordinatorProposal));}catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/coordinator/group",async(request,response)=>{
    try{
      const board=await store.read(request.params.id);
      if(request.body.identity!==board.coordinatorIdentity)throw new Error("Selected coordinator required");
      await verifyGroupMember(board.members.find(member=>member.identity===board.coordinatorIdentity)!);
      if(typeof request.body.groupId!=="string" || !/^[a-zA-Z0-9-]+$/.test(request.body.groupId))throw new Error("Invalid group ID");
      response.json(await store.update(board.id,request.body.baseRevision,request.body.actionId,current=>{if(current.discussionGroupId && current.discussionGroupId!==request.body.groupId)throw new Error("Group already initialized");current.discussionGroupId=request.body.groupId;return current;}));
    }catch(error){sendBoardError(response,error);}
  });
  router.get("/:id/artifacts/:name",async(request,response)=>{
    try { response.type("text/plain").send(await store.readArtifact(request.params.id,request.params.name)); } catch(error){sendBoardError(response,error);}
  });
  return router;
}
