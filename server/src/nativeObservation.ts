import {randomUUID} from "node:crypto";
import type {BoardStore} from "./boardStore.js";
import {listTasks,runOrca} from "./orca.js";

export async function refreshNativeBoard(store:BoardStore,boardId:string):Promise<void>{
 const before=await store.read(boardId);if(!before.implementationRunId)return;
 const tasks=await listTasks(before.implementationRunId);
 const coordinator=before.members.find(member=>member.identity===before.coordinatorIdentity);
 const envelope=coordinator?await runOrca<{messages:{id:string;body:string;type:string;from_handle:string;created_at:string}[]}>(["orchestration","check","--peek","--types","question","--terminal",coordinator.terminalHandle,"--run",before.implementationRunId]):{messages:[]};
 const changes: {attemptId:string;status:string;resultPath:string|null}[]=[];
 for(const attempt of before.attempts){
  const task=tasks.find(task=>task.id===attempt.taskId);
  if(!task || attempt.nativeStatus===task.status)continue;
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
