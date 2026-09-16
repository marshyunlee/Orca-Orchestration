import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSavedSessionContext} from '../src/sessionContext.js';
import {selectImportedTasks} from '../src/importDiscovery.js';
import type {MemberRef} from '../../shared/board.js';
import type {OrcaRun,OrcaTask} from '../src/orca.js';
const worker:MemberRef={identity:'codex:worker',source:'codex',sessionId:'worker',tabId:'tab',tabName:'SAME',terminalHandle:'term_worker',incarnationId:'inc',hostId:'local',workspacePath:'/same'};
const owner={...worker,identity:'codex:owner',sessionId:'owner',terminalHandle:'term_owner'};
const run={id:'run',coordinator_handle:owner.terminalHandle} as OrcaRun;
const task=(id:string,deps:string[]=[],assignee_handle:string|null=null)=>({id,run_id:'run',spec:id,task_title:id,status:'dispatched',deps:JSON.stringify(deps),assignee_handle,dispatch_id:`dispatch_${id}`,result:null}) as OrcaTask;
test('selected worker imports exact assignment and dependency closure, never directory peers',()=>{
 const rows=[task('assigned',['dependency'],worker.terminalHandle),task('dependency'),task('unrelated')];
 const items=selectImportedTasks([worker],[worker,owner],[run],new Map([['run',rows]]));
 assert.deepEqual(items.map(item=>item.native?.taskId).sort(),['assigned','dependency']);assert.ok(items.every(item=>item.ownerIdentity===owner.identity));
 assert.equal(selectImportedTasks([owner],[owner,worker],[run],new Map([['run',rows]])).length,3);
});
test('missing controlling owner remains explicit and does not become the selected worker',()=>{
 const [item]=selectImportedTasks([worker],[worker],[run],new Map([['run',[task('assigned',[],worker.terminalHandle)]]]));
 assert.equal(item.ownerIdentity,null);assert.equal(item.ownerHandle,owner.terminalHandle);
});
test('saved session lookup is exact, bounded and rejects escaping links',async()=>{
 const root=await mkdtemp(join(tmpdir(),'session-context-'));
 try{
  assert.equal((await readSavedSessionContext(worker,root)).available,false);
  await mkdir(join(root,'sources/agent_sessions/codex'),{recursive:true});await mkdir(join(root,'sessions'));
  await writeFile(join(root,'sessions/context.md'),'Useful current goal');
  await writeFile(join(root,'sources/agent_sessions/codex/worker.md'),'---\nupdated: 2026-09-16T00:00:00Z\n---\n[[sessions/context]] [[../../private]]\n'+'x'.repeat(60000));
  const saved=await readSavedSessionContext(worker,root);
  assert.equal(saved.available,true);assert.ok(saved.text.length<=24000);assert.ok(saved.references.includes('sessions/context.md'));assert.ok(!saved.references.some(path=>path.includes('private')));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Run inventory pagination and each Run task fetch occur exactly once',async()=>{
 const {discoverImportedWork}=await import('../src/importDiscovery.js');const calls:string[]=[];
 const native={runOrca:async<T>(args:string[]):Promise<T>=>{calls.push(args.join(' '));return (args.includes('--cursor')?{runs:[{...run,id:'second'}]}:{runs:[run],nextCursor:'next'}) as T;},listTasks:async(runId:string)=>{calls.push(`tasks ${runId}`);return [task(runId,[],worker.terminalHandle)];}};
 const result=await discoverImportedWork([worker],[owner,worker],native);
 assert.equal(result.items.length,2);assert.equal(calls.filter(call=>call==='tasks run').length,1);assert.equal(calls.filter(call=>call==='tasks second').length,1);
});

test('native rediscovery preserves enriched source content and the last observed Dispatch',async()=>{
 const {createBoardStore}=await import('../src/boardStore.js');const {mergeImportedWork}=await import('../src/importMerge.js');const {persistImportedItems}=await import('../src/importDiscovery.js');
 const root=await mkdtemp(join(tmpdir(),'source-refresh-')),store=await createBoardStore(root);
 try{
  let board=await store.create({title:'Sources',members:[],coordinatorIdentity:''},'create');
  const [item]=selectImportedTasks([owner],[owner],[run],new Map([['run',[task('one')]]]));
  board=await store.update(board.id,board.revision,'enrich',value=>{mergeImportedWork(value,[{...item,content:{...item.content,plan:'Fresh agent plan'}}]);return value;});
  const [updated]=await persistImportedItems(store,board,[{...item,native:{...item.native!,dispatchId:null}}],[]);
  assert.equal(updated.content.plan,'Fresh agent plan');assert.equal(updated.native?.dispatchId,'dispatch_one');
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
