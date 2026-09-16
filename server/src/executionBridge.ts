import { resolveBoardDependencies } from "./boardDependencies.js";
import {assertWorkspaceAvailable} from "./workspaceLease.js";
import { createHash, randomUUID } from "node:crypto";
import type { BoardStore } from "./boardStore.js";
import type { BoardSnapshot, Assignment, AttemptRef } from "../../shared/board.js";
import { isRecord } from "../../shared/board.js";
import { digestNodeInput, digestSpec } from "./boardGraph.js";
import { verifyGroupMember, isMemberIdle } from "./sessionDiscovery.js";
import type { NativeOperation, NativeReceipt, CoordinatorCaller } from "./orca.js";

export interface LaunchPermit {
  actionId:string;attemptId:string;nodeId:string;nodeRevision:number;promptPath:string;title:string;
  dependencies:{attemptId:string;taskId:string}[];assignment:Assignment;
  caller:CoordinatorCaller|null;runId:string;memberHandle:string|null;workspacePath:string;retryOf?:string;
}
interface LaunchPayload {permit:LaunchPermit;operation?:NativeOperation;operationToken?:string;receipt?:NativeReceipt}
export function hasActiveWriter(attempt:AttemptRef):boolean {
  return ["admitted","pending","ready","dispatched","blocked","unknown"].includes(attempt.nativeStatus) || (attempt.nativeStatus==="failed" && !attempt.stopped && !attempt.resultPath);
}
export function createExecutionBridge(store:BoardStore, members={verify:verifyGroupMember,idle:isMemberIdle}) {
  function payload(board:BoardSnapshot,actionId:string):LaunchPayload {
    const action=board.actions.find(action=>action.id===actionId);
    if(!action || action.kind!=="launch" || !isRecord(action.payload) || !action.payload.permit)throw new Error("Launch action not found");
    return action.payload as unknown as LaunchPayload;
  }
  return {
    async admitLaunch(boardId:string,nodeId:string,nodeRevision:number,actionId:string):Promise<LaunchPermit>{
      const before=await store.read(boardId);
      const existing=before.actions.find(action=>action.id===actionId);
      if(existing){const permit=payload(before,actionId).permit;if(permit.nodeId!==nodeId || permit.nodeRevision!==nodeRevision)throw new Error("Action ID belongs to different inputs");return permit;}
      const node=before.nodes.find(node=>node.id===nodeId && !node.removed && node.kind==="task");
      if(node?.collaborate)throw new Error("Use the component master and restricted collaborate launcher");
      if(!node || !node.assignment)throw new Error("Task assignment required");
      let memberHandle:string|null=null,workspacePath:string;
      if(node.assignment.kind==="member"){
        const assignment=node.assignment;
        const member=before.members.find(member=>member.identity===assignment.identity);
        if(!member)throw new Error("Assigned member is unavailable");
        if(member.identity===before.coordinatorIdentity)throw new Error("Explicit coordinator handover required before self-assignment");
        await members.verify(member);if(!await members.idle(member))throw new Error("Assigned member is busy; wait without interrupting it");
        memberHandle=member.terminalHandle;workspacePath=member.workspacePath;
      }else workspacePath=node.assignment.workspacePath;
      if(before.pauseNewStarts || before.pausedNodeIds.includes(nodeId))throw new Error("Starts are paused for this task");
      const dependencyEvidence=resolveBoardDependencies(before,nodeId);
      const dependencyResults=await Promise.all(dependencyEvidence.map(async evidence=>({evidence,content:evidence.artifactPath?await store.readArtifact(boardId,evidence.artifactPath):null})));
      const specification=before.nodes.find(candidate=>candidate.kind==='run' && !candidate.removed)?.content;
      const promptPath=await store.artifact(boardId,`prompt-${randomUUID()}`,`# ${node.title}\n\n${node.content.prompt}\n\nPlan:\n${node.content.plan}\n\nDesign:\n${node.content.design}\n\nImplementation notes:\n${node.content.implementationNotes}\n\nApproved root specification: ${JSON.stringify(specification)}\n\nFrozen dependency results: ${JSON.stringify(dependencyResults)}\nBoard: ${boardId}; node: ${node.id}; revision: ${node.revision}; launch: ${actionId}.\nWork only in the assigned workspace: ${workspacePath}. Preserve unrelated changes. Report using the native injected lifecycle IDs. Ask the coordinator about missing requirements.\n`);
      const after=await store.update(boardId,before.revision,`admit-${actionId}`,board=>{
        assertWorkspaceAvailable(workspacePath);
        if(board.pauseNewStarts || board.pausedNodeIds.includes(nodeId))throw new Error("Starts are paused for this task");
        const selected=board.nodes.find(node=>node.id===nodeId)!;
        if(selected.revision!==nodeRevision || board.acceptedNodeDigests[nodeId]!==digestNodeInput(board,nodeId))throw new Error("Task revision requires human approval through Preview/Start or rerun");
        if(!board.specApproval || board.specApproval.digest!==digestSpec(board))throw new Error("Specification approval is out of date");
        if(!board.implementationRunId)throw new Error("Coordinator must initialize the implementation Run first");
        if(board.attempts.some(attempt=>attempt.nodeId===nodeId && hasActiveWriter(attempt)))throw new Error("Task already has an active attempt");
        const retry=board.attempts.filter(attempt=>attempt.nodeId===nodeId && attempt.nodeRevision===nodeRevision && attempt.nativeStatus==="failed").at(-1);
        if(retry && (!retry.dispatchId || !retry.taskId || (!retry.stopped && !retry.resultPath)))throw new Error("Reconcile the previous attempt using native retry rules");
        if(retry && !board.actions.some(action=>action.kind==="stop-rerun" && action.phase==="applied" && action.nodeId===nodeId && isRecord(action.payload) && action.payload.attemptId===retry.id && action.payload.rerunReady))throw new Error("Choose Stop and rerun to authorize the failed attempt retry");
        if(memberHandle && board.attempts.some(attempt=>attempt.assigneeHandle===memberHandle && hasActiveWriter(attempt)))throw new Error("Member already has an active task");
        if(board.attempts.some(attempt=>attempt.nodeId===nodeId && attempt.nodeRevision===nodeRevision && attempt.nativeStatus==="completed"))throw new Error("This revision already completed; create an explicit follow-up revision");
        const dependencies=dependencyEvidence.filter(item=>item.kind==="direct" && item.runId===board.implementationRunId && item.taskId).map(item=>({attemptId:item.evidenceId,taskId:item.taskId!}));
        if(retry && JSON.stringify(dependencyEvidence.map(item=>item.evidenceId))!==JSON.stringify(retry.dependencyAttemptIds))throw new Error("Retry dependencies changed; review a revised task before launching");
        if(retry?.dependencyEvidence && JSON.stringify(retry.dependencyEvidence)!==JSON.stringify(dependencyEvidence))throw new Error("Retry dependency results changed; review a revised task before launching");
        const coordinator=board.members.find(member=>member.identity===board.coordinatorIdentity);
        const permit:LaunchPermit={actionId,attemptId:`attempt_${randomUUID()}`,nodeId,nodeRevision,promptPath:retry?.promptPath??promptPath,title:selected.title,dependencies,assignment:selected.assignment!,caller:coordinator?{identity:coordinator.identity,terminalHandle:coordinator.terminalHandle,incarnationId:coordinator.incarnationId,hostId:coordinator.hostId}:null,runId:board.implementationRunId,memberHandle,workspacePath,...(retry?{retryOf:retry.dispatchId}:{})};
        board.attempts.push({id:permit.attemptId,nodeId,nodeRevision,runId:permit.runId,taskId:retry?.taskId??"",dispatchId:"",assigneeHandle:memberHandle,ownsProcess:selected.assignment!.kind==="new-worker",nativeStatus:"admitted",workspacePath,promptPath:permit.promptPath,resultPath:null,guidancePaths:[],dependencyAttemptIds:dependencyEvidence.map(item=>item.evidenceId),dependencyEvidence,stopped:false});
        board.actions.push({id:actionId,kind:"launch",baseRevision:before.revision,phase:"queued",actor:board.coordinatorIdentity,nodeId,requestId:null,receiptPath:null,error:null,payload:{permit}});
        return board;
      });
      return payload(after,actionId).permit;
    },
    async pauseStarts(boardId:string,nodeIds:string[],actionId:string):Promise<BoardSnapshot>{
      const board=await store.read(boardId);
      return store.update(boardId,board.revision,actionId,current=>{if(nodeIds.length)current.pausedNodeIds=[...new Set([...current.pausedNodeIds,...nodeIds])];else current.pauseNewStarts=true;return current;});
    },
    async beginOperation(boardId:string,actionId:string):Promise<{operation:NativeOperation;token:string}>{
      const before=await store.read(boardId),launch=payload(before,actionId);
      const prompt=await store.readArtifact(boardId,launch.permit.promptPath);
      const token=randomUUID();
      const after=await store.update(boardId,before.revision,`operation-${token}`,board=>{
        const action=board.actions.find(action=>action.id===actionId)!,state=payload(board,actionId);
        if(action.phase==="unknown" || action.phase==="failed")throw new Error("Reconcile the native receipt before another operation");
        if(state.operationToken)throw new Error("Native operation already admitted; inspect its receipt before retrying");
        const attempt=board.attempts.find(attempt=>attempt.id===state.permit.attemptId)!;
        if(attempt.dispatchId || action.phase==="applied")throw new Error("Launch already completed");
        const assignment=state.permit.assignment;
        const operation:NativeOperation=attempt.taskId?{kind:"start-worker",taskId:attempt.taskId,runId:attempt.runId,...(state.permit.retryOf?{retryOf:state.permit.retryOf}:{}),assignment:assignment.kind==="member"?{kind:"member",terminalHandle:state.permit.memberHandle!,workspacePath:state.permit.workspacePath}:assignment}:{kind:"create-task",runId:attempt.runId,title:state.permit.title,spec:prompt,dependencies:state.permit.dependencies.map(item=>item.taskId)};
        state.operation=operation;state.operationToken=token;action.phase="claimed";return board;
      });
      return {operation:payload(after,actionId).operation!,token};
    },
    async recordNativeReceipt(boardId:string,actionId:string,token:string,receipt:NativeReceipt):Promise<BoardSnapshot>{
      if(!receipt || !["applied","failed","unknown"].includes(receipt.phase))throw new Error("Invalid native receipt");
      const path=await store.artifact(boardId,`native-${randomUUID()}`,JSON.stringify(receipt));
      const before=await store.read(boardId);
      return store.update(boardId,before.revision,`receipt-${token}-${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}`,board=>{
        const state=payload(board,actionId),action=board.actions.find(action=>action.id===actionId)!;
        if(state.operationToken!==token)throw new Error("Receipt belongs to another operation");
        const attempt=board.attempts.find(attempt=>attempt.id===state.permit.attemptId)!;
        state.receipt=receipt;action.requestId=receipt.requestId;action.receiptPath=path;action.error=receipt.error;
        if(receipt.phase!=="applied"){action.phase=receipt.phase;attempt.nativeStatus=receipt.phase;return board;}
        if(state.operation?.kind==="create-task"){
          if(!receipt.taskId){action.phase="unknown";attempt.nativeStatus="unknown";action.error="Native task ID missing; inspect retained receipt";return board;}
          attempt.taskId=receipt.taskId;attempt.nativeStatus="ready";action.phase="queued";delete state.operationToken;delete state.operation;
        }else{
          if(!receipt.dispatchId){action.phase="unknown";attempt.nativeStatus="unknown";action.error="Native dispatch ID missing; inspect retained receipt";return board;}
          attempt.dispatchId=receipt.dispatchId;
          const raw=receipt.raw as {result?:{dispatch?:{assignee_handle?:string};effects?:{role?:string;kind?:string;id?:string}[]}};
          attempt.assigneeHandle=raw?.result?.dispatch?.assignee_handle ?? raw?.result?.effects?.find(effect=>effect.kind==="terminal" && effect.role==="agent")?.id ?? attempt.assigneeHandle;
          attempt.nativeStatus="dispatched";action.phase="applied";
        }
        return board;
      });
    },
  };
}
