import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerComponentRun} from '../src/componentRegistry.js';
test('Run registry keeps active ownership and allows a proven retired node to advance to an increment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'component-registry-')),prior=process.env.ORCA_BOARD_RUNTIME;process.env.ORCA_BOARD_RUNTIME=root;
 const binding={boardId:'board',nodeId:'old',runId:'run',masterIdentity:'codex:master',terminalHandle:'master',manifestPath:'/manifest',url:'http://127.0.0.1:8788'};
 try{
  await registerComponentRun(binding);await registerComponentRun(binding);
  const next={...binding,nodeId:'increment'};
  await assert.rejects(registerComponentRun(next),/already belongs/);
  await registerComponentRun(next,previous=>previous.boardId==='board' && previous.nodeId==='old');
  assert.equal(JSON.parse(await readFile(join(root,'component-runs/run.json'),'utf8')).nodeId,'increment');
 }finally{if(prior===undefined)delete process.env.ORCA_BOARD_RUNTIME;else process.env.ORCA_BOARD_RUNTIME=prior;await rm(root,{recursive:true,force:true});}
});
