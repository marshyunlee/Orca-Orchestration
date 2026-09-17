import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBoardSnapshot,createBoardNode} from '../../shared/board.js';
import {compactBoardOutput} from '../src/boardOutput.js';

test('compact CLI output retains controls and provenance without replaying content or history',()=>{
 const board=createBoardSnapshot('board_test','Example',[],'coordinator');
 const node=createBoardNode('task','task','Task');node.content.prompt='Large source '.repeat(1000);board.nodes.push(node);
 board.messages.push({id:'history',author:'owner',body:'Old discussion '.repeat(1000),createdAt:'now'});
 board.actions.push({id:'action',kind:'guidance',baseRevision:1,phase:'queued',actor:'human',nodeId:node.id,requestId:'native-request',receiptPath:null,error:null,payload:{body:'Change the output'}});
 const original=JSON.stringify(board),output=compactBoardOutput({board,url:'http://localhost:8787'});
 const data=output as {board:Record<string,unknown>;url:string};
 assert.equal(data.url,'http://localhost:8787');assert.equal(data.board.revision,board.revision);assert.deepEqual(data.board.actions,board.actions);
 assert.ok(JSON.stringify(output).length<original.length/10);
 assert.equal(JSON.stringify(board),original);
 assert.equal(data.board.messages,undefined);
});

test('native receipts and explicit details remain unmodified',()=>{
 const receipt={ok:true,result:{messages:[{body:'Answer'}],mutation:{requestId:'original'}}};
 assert.deepEqual(compactBoardOutput(receipt),receipt);
});

import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('packaged CLI path offers compact status while full reads retain their contract',async()=>{
 const board=createBoardSnapshot('board_test','Fixture',[],'');board.nodes[0].content.prompt='Full specification';
 const root=await mkdtemp(join(tmpdir(),'board-cli-output-')),token=join(root,'token');await writeFile(token,'fixture');
 const server=createServer((request,response)=>{
  assert.equal(request.method,'GET');assert.equal(request.url,'/api/boards/board_test');
  assert.equal(request.headers['x-board-token'],'fixture');response.setHeader('Content-Type','application/json');response.end(JSON.stringify(board));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address() as {port:number};
  const run=async(command:string)=>JSON.parse((await promisify(execFile)(process.execPath,['--import','tsx','server/src/boardCli.ts',command,'--board',board.id,'--url',`http://127.0.0.1:${address.port}`,'--token-file',token])).stdout);
  assert.deepEqual(await run('read'),board);
  const status=await run('status');assert.equal(status.id,board.id);assert.equal(status.nodes[0].content,undefined);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
