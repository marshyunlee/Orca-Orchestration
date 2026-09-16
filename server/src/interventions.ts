import {createHash,randomUUID} from "node:crypto";
import type {BoardStore} from "./boardStore.js";
import {isRecord,type BoardSnapshot,type ActionRecord} from "../../shared/board.js";
import {digestNodeInput} from "./boardGraph.js";
import {hasActiveWriter} from "./executionBridge.js";
import type {NativeOperation,NativeReceipt} from "./orca.js";

function actionPayload(action:ActionRecord):Record<string,unknown>{if(!isRecord(action.payload))throw new Error("Action payload missing");return action.payload;}
export function createActionExecutor(store:BoardStore){
 return {
  async begin(boardId:string,actionId:string,identity:string):Promise<{operation:NativeOperation|null;token:string|null;waiting?:string}>{
   const before=await store.read(boardId),action=before.actions.find(action=>action.id===actionId);
   if(!action || action.phase!=="claimed" || action.actor!==identity || identity!==before.coordinatorIdentity)throw new Error("Claim this action from its selected coordinator first");
   const data=actionPayload(action);
   if(data.effectToken)throw new Error("Action effect already admitted; reconcile its receipt");
   const node=before.nodes.find(node=>node.id===action.nodeId);
   const attempt=before.attempts.filter(attempt=>attempt.nodeId===action.nodeId).at(-1);
   let operation:NativeOperation|null=null,guidancePath:string|null=null;
   const alreadySettled=attempt && ["completed","failed"].includes(attempt.nativeStatus) && Boolean(attempt.resultPath);
   switch(action.kind){
    case "handover": {
      const remaining=Array.isArray(data.remainingRunIds)?data.remainingRunIds:[];
      if(remaining.length)operation={kind:"bind-run",runId:String(remaining[0])};break;
    }
    case "reconcile": {
      const targetId=isRecord(data.data)?data.data.targetActionId:null;
      const target=before.actions.find(item=>item.id===targetId);
      if(!target || ["unknown","claimed"].includes(target.phase))throw new Error("Reconcile the target native receipt before completing this request");
      break;
    }
    case "resume":
      break;
    case "start":
      if(!before.implementationRunId)operation={kind:"create-run",objective:`${before.title} · ${before.deliveryId}`};
      break;
    case "guidance":
      if(!node || !attempt || !hasActiveWriter(attempt) || !attempt.dispatchId)throw new Error("No active attempt to guide");
      guidancePath=await store.artifact(boardId,`guidance-${randomUUID()}`,JSON.stringify({nodeId:node.id,revision:node.revision,content:node.content,body:data.body}));
      operation={kind:"send-guidance",dispatchId:attempt.dispatchId,body:`Human guidance for ${node.title}, revision ${node.revision}. Original attempt inputs remain recorded.\n${JSON.stringify(node.content)}\n${String(data.body??"")}\nAcknowledge the revision and report what you applied separately from message delivery.`};break;
    case "stop-rerun":
      if(!node || !attempt || !attempt.dispatchId)throw new Error("No attempt to stop");
      if(alreadySettled)break;
      if(!attempt.ownsProcess && !attempt.stopped){
        if(data.stopRequested)return {operation:null,token:null,waiting:"Waiting for member-confirmed stopped work"};
        operation={kind:"send-guidance",dispatchId:attempt.dispatchId,body:`The human requested Stop and rerun for board ${boardId}, node ${node.id}. Stop current work and all child writers at the next checkpoint; preserve this agent session. Once no writer remains, run ${process.env.ORCA_BOARD_CLI??"boardctl"} attest-stop --board ${boardId} --attempt ${attempt.id} --evidence "Describe the stopped work and verification" --url ${process.env.ORCA_BOARD_URL??`http://127.0.0.1:${process.env.PORT??8787}`}, then end this turn and idle. The coordinator will fence the old Dispatch and prepare the revised task. Do not start new work.`};
        const question=before.messages.find(message=>message.nativeMessageId && !message.answered && message.author===`dispatch:${attempt.dispatchId}`);
        if(question?.nativeMessageId)operation={kind:"reply-question",messageId:question.nativeMessageId,body:operation.body};
      }else operation={kind:"stop-worker",dispatchId:attempt.dispatchId};
      break;
    case "answer-question":{
      const fields=isRecord(data.data)?data.data:{};
      const message=before.messages.find(message=>message.nativeMessageId===fields.messageId && !message.answered);
      if(!message?.nativeMessageId)throw new Error("Unanswered native question not found");
      operation={kind:"reply-question",messageId:message.nativeMessageId,body:String(data.body??"")};break;
    }
    default:throw new Error("Action has no native execution operation");
   }
   const token=randomUUID();
   await store.update(boardId,before.revision,`effect-${token}`,board=>{
     const current=board.actions.find(action=>action.id===actionId)!;
     const payload=actionPayload(current);if(payload.effectToken)throw new Error("Action effect already admitted");
     if(!operation){
       if(action.kind==="stop-rerun" && attempt && node){
         const selected=board.nodes.find(item=>item.id===node.id)!;
         if(attempt.nativeStatus==="completed" && selected.revision===attempt.nodeRevision)selected.revision++;
         board.acceptedNodeDigests[node.id]=digestNodeInput(board,node.id);payload.attemptId=attempt.id;payload.rerunReady=true;
         board.messages.push({id:randomUUID(),author:identity,body:"The previous attempt settled before Stop. Its result is preserved; the requested rerun is ready.",createdAt:new Date().toISOString()});
       }
       current.phase="applied";return board;
     }
     payload.effectToken=token;payload.operation=operation;payload.guidancePath=guidancePath;payload.attemptId=attempt?.id??null;return board;
   });
   return {operation,token:operation?token:null};
  },
  async finish(boardId:string,actionId:string,token:string,receipt:NativeReceipt):Promise<BoardSnapshot>{
   if(!receipt || !["applied","failed","unknown"].includes(receipt.phase))throw new Error("Native receipt required");
   const path=await store.artifact(boardId,`effect-receipt-${randomUUID()}`,JSON.stringify(receipt));
   const before=await store.read(boardId);
   return store.update(boardId,before.revision,`effect-receipt-${token}-${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}`,board=>{
    const action=board.actions.find(action=>action.id===actionId)!;const data=actionPayload(action);
    if(data.effectToken!==token)throw new Error("Effect receipt belongs to a different admission");
    const operation=data.operation as NativeOperation;
    const attempt=board.attempts.find(attempt=>attempt.id===data.attemptId);
    action.requestId=receipt.requestId;action.receiptPath=path;action.error=receipt.error;
    if(receipt.phase!=="applied"){action.phase=receipt.phase;return board;}
    const raw=receipt.raw as {result?:{state?:string;processAction?:string;close?:{ptyKilled?:boolean}}};
    if(operation.kind==="bind-run"){
      const remaining=Array.isArray(data.remainingRunIds)?data.remainingRunIds:[];
      data.remainingRunIds=remaining.slice(1);delete data.effectToken;delete data.operation;
      if(remaining.length>1)return board;
    }
    if(operation.kind==="create-run"){
      if(!receipt.runId){action.phase="unknown";action.error="Missing native Run ID";return board;}
      if(board.implementationRunId && board.implementationRunId!==receipt.runId)throw new Error("Run already initialized");
      board.implementationRunId=receipt.runId;
    }
    if(operation.kind==="reply-question")for(const message of board.messages)if(message.nativeMessageId===operation.messageId)message.answered=true;
    if((operation.kind==="send-guidance" || operation.kind==="reply-question") && attempt){
      if(typeof data.guidancePath==="string")attempt.guidancePaths.push(data.guidancePath);
      if(action.kind==="stop-rerun"){data.stopRequested=true;delete data.effectToken;delete data.operation;return board;}
    }
    if(operation.kind==="stop-worker" && attempt){
      const exited=receipt.liveness==="exited" || raw.result?.close?.ptyKilled===true;
      if(raw.result?.state!=="stopped" || (!exited && !attempt.stopped)){
        action.phase="unknown";action.error="Stop has no proof that work stopped; no replacement may launch";return board;
      }
      attempt.stopped=true;attempt.nativeStatus="failed";
      const node=board.nodes.find(node=>node.id===attempt.nodeId)!;
      board.acceptedNodeDigests[node.id]=digestNodeInput(board,node.id);data.rerunReady=true;
    }

    action.phase="applied";return board;
   });
  },
  async attestStopped(boardId:string,attemptId:string,identity:string,evidence:string):Promise<BoardSnapshot>{
   if(typeof evidence!=="string" || !evidence.trim())throw new Error("Stop evidence required");
   const before=await store.read(boardId),attempt=before.attempts.find(attempt=>attempt.id===attemptId);
   const launch=before.actions.find(action=>action.kind==="launch" && isRecord(action.payload) && isRecord(action.payload.permit) && action.payload.permit.attemptId===attemptId);
   const permit=isRecord(launch?.payload)&&isRecord(launch.payload.permit)?launch.payload.permit:null;
   const assignment=isRecord(permit?.assignment)?permit.assignment:null;
   if(!attempt || attempt.ownsProcess || assignment?.identity!==identity || !before.actions.some(action=>action.kind==="stop-rerun" && action.nodeId===attempt.nodeId && action.phase==="claimed"))throw new Error("Only this requested member may attest stopped work");
   const path=await store.artifact(boardId,`member-stop-${randomUUID()}`,JSON.stringify({identity,attemptId,evidence,at:new Date().toISOString()}));
   return store.update(boardId,before.revision,`member-stop-${randomUUID()}`,board=>{
     const current=board.attempts.find(attempt=>attempt.id===attemptId)!;current.stopped=true;
     board.messages.push({id:randomUUID(),author:identity,body:`Stopped work confirmed: ${evidence}\nEvidence: ${path}`,createdAt:new Date().toISOString()});return board;
   });
  },
 };
}
