import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBoardSnapshot, type MemberRef } from '../../shared/board.js';
import { resolveBoardEntry, resolveEntryMembers, resolveEntryRole } from '../src/boardEntry.js';
const member=(id:string,name:string):MemberRef=>({identity:`codex:${id}`,source:'codex',sessionId:id,tabId:id,tabName:name,terminalHandle:`term_${id}`,incarnationId:id,hostId:'host',workspacePath:'/fixture'});
test('entry rejects duplicate tab names and includes the actual calling session',()=>{
 const caller=member('caller','Coordinator'),worker=member('worker','WORKER');
 assert.deepEqual(resolveEntryMembers([caller,worker],['WORKER'],caller.terminalHandle),[caller,worker]);
 assert.throws(()=>resolveEntryMembers([caller,worker,member('second','WORKER')],['WORKER'],caller.terminalHandle),/ambiguous/);
 assert.throws(()=>resolveEntryMembers([caller],['MISSING'],caller.terminalHandle),/not found/);
 assert.throws(()=>resolveEntryMembers([worker],['WORKER'],caller.terminalHandle),/calling session/);
});
test('resume requires an exact unambiguous board and preserves a component master role',()=>{
 const master=member('master','WORKER'),coordinator=member('coordinator','Coordinator');
 const first=createBoardSnapshot('board_first','Delivery',[coordinator,master],coordinator.identity);
 const second=createBoardSnapshot('board_second','Delivery',[coordinator],coordinator.identity);
 assert.equal(resolveBoardEntry([first,second],{id:first.id}).id,first.id);
 assert.throws(()=>resolveBoardEntry([first,second],{title:'Delivery'}),/ambiguous/);
 assert.throws(()=>resolveBoardEntry([first],{}),/ID or title/);
 first.nodes.push({id:'component',kind:'task',title:'Work',revision:1,content:{prompt:'',plan:'',design:'',implementationNotes:''},assignment:null,collaborate:{masterIdentity:master.identity,manifestPath:'/fixture/manifest.json'},position:{x:1,y:1},removed:false});
 assert.deepEqual(resolveEntryRole(first,master.terminalHandle),{identity:master.identity,role:'component-master',nodeIds:['component']});
 assert.equal(first.implementationRunId,null);
 assert.throws(()=>resolveEntryRole(first,'term_unknown'),/member/);
});
