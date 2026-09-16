import {refreshImportedWork} from './importDiscovery.js';
import {randomUUID} from "node:crypto";
import type {BoardStore} from "./boardStore.js";
import {callGroupHelper} from "./groupAdapter.js";
import type {BoardSnapshot} from "../../shared/board.js";
import {listTasks,runOrca} from "./orca.js";

export const discussionStatuses=new Map<string,NonNullable<BoardSnapshot["discussionStatus"]>>();
export async function refreshDiscussionStatus(board:BoardSnapshot):Promise<void>{
 if(!board.discussionGroupId)return;
 const group=await callGroupHelper(["status","--group",board.discussionGroupId]);
 discussionStatuses.set(board.id,{status:group.status,cycle:Number(group.cycle),round:Number(group.round),remainingRounds:Number(group.remaining_rounds),remainingSeconds:Math.max(0,Math.floor(Number(group.deadline)-Date.now()/1000)),outstanding:Array.isArray(group.outstanding)?group.outstanding.length:0});
}
export const observationErrors=new Map<string,string>();

export async function refreshNativeBoard(store:BoardStore,boardId:string, native={listTasks,runOrca}):Promise<void>{
 const fetched=new Map<string,ReturnType<typeof listTasks>>();
 const fetchTasks=(runId:string)=>{let tasks=fetched.get(runId);if(!tasks){tasks=native.listTasks(runId);fetched.set(runId,tasks);}return tasks;};
 await refreshImportedWork(store,boardId,{listTasks:fetchTasks});
 const before=await store.read(boardId);if(!before.implementationRunId)return;
 const tasks=await fetchTasks(before.implementationRunId);
 const coordinator=before.members.find(member=>member.identity===before.coordinatorIdentity);
 const envelope=coordinator?await native.runOrca<{messages:{id:string;body:string;type:string;from_handle:string;created_at:string}[]}>(["orchestration","check","--peek","--types","question","--terminal",coordinator.terminalHandle,"--run",before.implementationRunId]):{messages:[]};
 const changes: {attemptId:string;status:string;resultPath:string|null}[]=[];
 for(const attempt of before.attempts){
  const task=tasks.find(task=>task.id===attempt.taskId);
  if(!task || attempt.stopped || before.attempts.filter(item=>item.taskId===attempt.taskId).at(-1)?.id!==attempt.id)continue;
  if(task.status==="dispatched" && task.dispatch_id && task.dispatch_id!==attempt.dispatchId)continue;
  const previousResult=attempt.resultPath?await store.readArtifact(boardId,attempt.resultPath):null;
  if(attempt.nativeStatus===task.status && (task.result??null)===previousResult)continue;
  const resultPath=task.result?await store.artifact(boardId,`result-${randomUUID()}`,task.result):attempt.resultPath;
  changes.push({attemptId:attempt.id,status:task.status,resultPath});
 }
 const questions=(envelope.messages??[]).filter(message=>message.type==="question" && !before.messages.some(existing=>existing.nativeMessageId===message.id) && before.attempts.some(attempt=>`dispatch:${attempt.dispatchId}`===message.from_handle && attempt.nativeStatus==="dispatched"));
 if(!changes.length && !questions.length)return;
 await store.update(boardId,before.revision,`observation-${randomUUID()}`,board=>{
  for(const change of changes){const attempt=board.attempts.find(attempt=>attempt.id===change.attemptId)!;attempt.nativeStatus=change.status;attempt.resultPath=change.resultPath;}
  for(const question of questions)board.messages.push({id:randomUUID(),author:question.from_handle,body:question.body,createdAt:question.created_at,nativeMessageId:question.id,answered:false});
  return board;
 });
}

export async function refreshComponentQuestions(store:BoardStore,boardId:string,native={runOrca}):Promise<void>{
 const before=await store.read(boardId);
 const questions:BoardSnapshot["messages"]=[];
 for(const [nodeId,state] of Object.entries(before.components)){
  const master=before.members.find(member=>member.identity===state.masterIdentity);
  if(!master)continue;
  const envelope=await native.runOrca<{messages:{id:string;body:string;type:string;from_handle:string;created_at:string}[]}>(["orchestration","check","--peek","--types","question","--terminal",master.terminalHandle,"--run",state.runId]);
  for(const message of envelope.messages??[])if(message.type==="question" && !before.messages.some(existing=>existing.nativeMessageId===message.id) && state.tasks.some(task=>task.dispatchId && `dispatch:${task.dispatchId}`===message.from_handle))questions.push({id:randomUUID(),author:message.from_handle,body:message.body,createdAt:message.created_at,nativeMessageId:message.id,componentNodeId:nodeId,answered:false});
 }
 if(questions.length)await store.update(boardId,before.revision,`component-questions-${randomUUID()}`,board=>{board.messages.push(...questions);return board;});
}
