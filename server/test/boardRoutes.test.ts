import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewerApp } from "../src/app.js";
import { createBoardStore } from "../src/boardStore.js";

test("board HTTP writes require local origin, token, and revision; retries do not duplicate tasks", async () => {
  const root=await mkdtemp(join(tmpdir(),"board-http-"));
  const store=await createBoardStore(root);
  const app=createViewerApp(root,{store,token:"fixture-token"});
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address() as {port:number};
  const base=`http://127.0.0.1:${address.port}`;
  const send=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
  const headers={origin:base,"x-board-token":"fixture-token"};
  try {
    assert.equal((await send("/api/boards",{}, {origin:"https://untrusted.example","x-board-token":"fixture-token"})).status,403);
    assert.equal((await send("/api/boards",{}, {origin:base})).status,403);
    const created=await send("/api/boards",{actionId:"create",title:"Group",members:[],coordinatorIdentity:""},headers);
    assert.equal(created.status,200);
    const board=await created.json();
    const edit={actionId:"add",baseRevision:board.revision,operation:{kind:"add-task",title:"Task"}};
    const saved=await send(`/api/boards/${board.id}/edit`,edit,headers);
    assert.equal(saved.status,200);
    const replay=await send(`/api/boards/${board.id}/edit`,edit,headers);
    assert.equal((await replay.json()).nodes.length,2);
    const conflict=await send(`/api/boards/${board.id}/edit`,{...edit,actionId:"other"},headers);
    assert.equal(conflict.status,409);
    assert.equal((await conflict.json()).currentRevision,2);
    assert.equal((await send(`/api/boards/${board.id}/edit`,{actionId:"invalid",baseRevision:2,operation:{kind:"arbitrary-shell",command:"touch forbidden"}},headers)).status,400);
    assert.equal((await fetch(base+"/api/auth",{headers:{origin:"https://untrusted.example"}})).status,403);
    const hostileHost=await new Promise<number|undefined>((resolve,reject)=>{ const req=httpRequest(base+"/api/boards",{headers:{host:"attacker.example"}},res=>{res.resume();resolve(res.statusCode);}); req.on("error",reject); req.end(); });
    assert.equal(hostileHost,403);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); await store.close(); await rm(root,{recursive:true,force:true}); }
});
