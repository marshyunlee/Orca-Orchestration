import {randomUUID} from 'node:crypto';
import type {BoardSnapshot,MemberRef} from '../../shared/board.js';
import {importedSourceKey,type ImportedItem} from '../../shared/imports.js';
import {listTasks,runOrca,type OrcaTask,type OrcaRun} from './orca.js';
import type {BoardStore} from './boardStore.js';
import {mergeImportedWork} from './importMerge.js';
import {digestValue} from './boardGraph.js';
export function selectImportedTasks(members:MemberRef[],inventory:MemberRef[],runs:OrcaRun[],tasksByRun:Map<string,OrcaTask[]>):ImportedItem[]{
 const items:ImportedItem[]=[];
 for(const run of runs){
  const tasks=tasksByRun.get(run.id)??[];
  const owner=inventory.find(member=>member.terminalHandle===run.coordinator_handle);
  for(const member of members){
   const selected=new Set(tasks.filter(task=>run.coordinator_handle===member.terminalHandle || task.assignee_handle===member.terminalHandle).map(task=>task.id));
   const visit=(id:string)=>{const task=tasks.find(task=>task.id===id);if(!task)return;for(const dep of parseDependencies(task.deps))if(!selected.has(dep)){selected.add(dep);visit(dep);}};
   for(const id of [...selected])visit(id);
   for(const task of tasks.filter(task=>selected.has(task.id)))items.push({itemId:task.id,sourceIdentity:member.identity,ownerIdentity:owner?.identity??null,ownerHandle:run.coordinator_handle,native:{hostId:owner?.hostId??'local',runId:run.id,taskId:task.id,dispatchId:task.dispatch_id??null},title:task.task_title??task.display_name??task.id,content:{prompt:task.spec,plan:'',design:'',implementationNotes:''},status:task.status,observedAt:new Date().toISOString(),references:[`orca:run:${run.id}:task:${task.id}`],dependencies:parseDependencies(task.deps),resultPath:null,workspacePath:inventory.find(candidate=>candidate.terminalHandle===task.assignee_handle)?.workspacePath});
  }
 }
 return items;
}
function parseDependencies(value:string):string[]{const parsed:unknown=JSON.parse(value||'[]');if(!Array.isArray(parsed)||parsed.some(id=>typeof id!=='string'))throw new Error('Invalid native dependencies');return parsed;}
export async function discoverImportedWork(members:MemberRef[],inventory:MemberRef[],native={runOrca,listTasks}):Promise<{items:ImportedItem[];tasks:OrcaTask[]}>{
 const runs:OrcaRun[]=[];let cursor:string|undefined;
 do{const page=await native.runOrca<{runs:OrcaRun[];nextCursor?:string}>(['orchestration','run-list','--limit','100',...(cursor?['--cursor',cursor]:[])]);runs.push(...page.runs.filter(run=>run.legacy!==1));if(page.nextCursor===cursor && cursor)throw new Error('Native Run cursor did not advance');cursor=page.nextCursor;}while(cursor);
 const entries=await Promise.all(runs.map(async run=>[run.id,await native.listTasks(run.id)] as const));
 const tasksByRun=new Map(entries);
 return {items:selectImportedTasks(members,inventory,runs,tasksByRun),tasks:entries.flatMap(([,tasks])=>tasks)};
}
export async function persistImportedItems(store:BoardStore,board:BoardSnapshot,items:ImportedItem[],tasks:OrcaTask[]):Promise<ImportedItem[]>{
 const results=new Map<string,string>();
 for(const item of items){
  const task=tasks.find(task=>task.run_id===item.native?.runId && task.id===item.native.taskId);
  const previous=board.nodes.find(node=>node.imported?.key===importedSourceKey(item))?.imported;
  if(task?.result){
   const key=importedSourceKey(item);let path=results.get(key);
   if(!path && previous?.resultPath && await store.readArtifact(board.id,previous.resultPath)===task.result)path=previous.resultPath;
   if(!path)path=await store.artifact(board.id,`source-result-${randomUUID()}`,task.result);
   results.set(key,path);item.resultPath=path;
  }
 }
 return items;
}
export function mergeImportedDependencies(board:BoardSnapshot):void{
 for(const node of board.nodes.filter(node=>node.imported && !node.removed)){
  for(const taskId of node.imported!.dependencies){
   const source=board.nodes.find(candidate=>!candidate.removed && candidate.imported?.native?.hostId===node.imported!.native?.hostId && candidate.imported?.native?.runId===node.imported!.native?.runId && candidate.imported?.native?.taskId===taskId);
   if(!source)continue;
   const key=`native-edge-${digestValue([source.id,node.id])}`;
   if(!board.collection.suppressedEdges.includes(key) && !board.edges.some(edge=>edge.source===source.id && edge.target===node.id))board.edges.push({id:key,source:source.id,target:node.id,importedKey:key});
  }
 }
}
export async function refreshImportedWork(store:BoardStore,boardId:string,native={listTasks}):Promise<void>{
 const before=await store.read(boardId),imports=before.nodes.filter(node=>node.imported?.native && !node.removed);
 if(!imports.length)return;
 const runs=[...new Set(imports.map(node=>node.imported!.native!.runId))];
 const tasks=(await Promise.all(runs.map(runId=>native.listTasks(runId)))).flat();
 const updates:ImportedItem[]=[];
 for(const node of imports){
  const prior=node.imported!;const task=tasks.find(task=>task.id===prior.native!.taskId && task.run_id===prior.native!.runId);if(!task)continue;
  const item={...prior,status:task.status,native:{...prior.native!,dispatchId:task.dispatch_id??prior.native!.dispatchId},observedAt:new Date().toISOString(),title:prior.baseline.title,content:prior.baseline.content};
  updates.push(item);
 }
 await persistImportedItems(store,before,updates,tasks);
 if(updates.every(item=>{const prior=imports.find(node=>node.imported!.key===importedSourceKey(item))!.imported!;return prior.status===item.status && prior.native?.dispatchId===item.native?.dispatchId && prior.resultPath===item.resultPath;}))return;
 await store.update(boardId,before.revision,`import-observe-${randomUUID()}`,board=>{mergeImportedWork(board,updates);return board;});
}
