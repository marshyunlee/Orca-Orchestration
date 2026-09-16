import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createBoardStore} from "../src/boardStore.js";
import {createViewerApp} from "../src/app.js";
import {createBoardNode} from "../../shared/board.js";
import {digestFile} from "../src/workspaceEdits.js";

test("Apply requires a stopped writer, preserves drafts and replays without a second file write",async()=>{
 const root=await mkdtemp(join(tmpdir(),"apply-http-")),workspace=await mkdtemp(join(tmpdir(),"apply-work-")),store=await createBoardStore(root);
 const server=createViewerApp(root,{store,token:"test"}).listen(0,"127.0.0.1");
 await new Promise<void>(resolve=>server.once("listening",resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const post=(path:string,data:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json","x-board-token":"test"},body:JSON.stringify(data)});
 try{
  await writeFile(join(workspace,"code.js"),"original");
  let board=await store.create({title:"Fixture",members:[],coordinatorIdentity:""},"create");
  board=await store.update(board.id,board.revision,"setup",current=>{
   const node=createBoardNode("task","task","Task");node.assignment={kind:"new-worker",agent:"codex",workspacePath:workspace};current.nodes.push(node);
   current.attempts.push({id:"attempt",nodeId:"task",nodeRevision:1,runId:"run",taskId:"native-task",dispatchId:"dispatch",assigneeHandle:"worker",ownsProcess:true,nativeStatus:"dispatched",workspacePath:workspace,promptPath:"prompt",resultPath:null,guidancePaths:[],dependencyAttemptIds:[],stopped:false});return current;
  });
  const endpoint=`/api/boards/${board.id}/files`;
  const staged=await post(endpoint+"/stage",{baseRevision:board.revision,actionId:"draft",nodeId:"task",edits:[{path:"code.js",baseDigest:digestFile("original"),content:"edited"}]});
  assert.equal(staged.status,200);board=(await staged.json()).snapshot;
  assert.equal(await readFile(join(workspace,"code.js"),"utf8"),"original");
  const application={baseRevision:board.revision,actionId:"apply",draftId:"draft"};
  assert.equal((await post(endpoint+"/apply",application)).status,400);
  board=await store.update(board.id,board.revision,"stop",current=>{current.attempts[0].stopped=true;current.attempts[0].nativeStatus="failed";return current;});
  application.baseRevision=board.revision;
  const applied=await post(endpoint+"/apply",application);assert.equal(applied.status,200);assert.equal((await applied.json()).action.phase,"applied");
  assert.equal(await readFile(join(workspace,"code.js"),"utf8"),"edited");
  await writeFile(join(workspace,"code.js"),"later human edit");
  const replay=await post(endpoint+"/apply",application);assert.equal(replay.status,200);assert.equal((await replay.json()).action.phase,"applied");
  assert.equal(await readFile(join(workspace,"code.js"),"utf8"),"later human edit");
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();await rm(root,{recursive:true,force:true});await rm(workspace,{recursive:true,force:true});}
});
