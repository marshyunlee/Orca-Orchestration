import React from 'react';
Object.assign(globalThis,{React});
import assert from 'node:assert/strict';import {test} from 'node:test';import {renderToStaticMarkup} from 'react-dom/server';
import {SessionPicker} from '../src/components/SessionPicker.js';import {CollectionPanel} from '../src/components/CollectionPanel.js';import {ImportedTaskPanel} from '../src/components/ImportedTaskPanel.js';import {createBoardSnapshot,type MemberRef} from '../../shared/board.js';import {mergeImportedWork} from '../../server/src/importMerge.js';
const member:MemberRef={identity:'codex:one',source:'codex',sessionId:'one',tabId:'tab',tabName:'SAME',terminalHandle:'term_one',incarnationId:'inc',hostId:'local',workspacePath:'/workspace'};
test('existing session picker disambiguates duplicate labels before group creation',()=>{
 const other={...member,identity:'codex:two',sessionId:'two',terminalHandle:'term_two'};
 const html=renderToStaticMarkup(<SessionPicker inventory={{members:[member,other],unavailable:[]}} members={[member]} coordinatorIdentity={member.identity} onChange={()=>{}}/>);
 assert.match(html,/codex:one/);assert.match(html,/codex:two/);assert.match(html,/Coordinator/);assert.match(html,/Connected/);
});
test('collection and imported controls show pending replies, original owner and cooperative limits',()=>{
 const board=createBoardSnapshot('board_test','Existing',[member],member.identity);
 board.collection.requests.push({id:'request',member,createdAt:'today',savedPath:null,savedCapturedAt:null,contextError:'No saved context',delivery:'sent',requestId:null,receiptPath:null,responsePath:null,respondedAt:null});
 const html=renderToStaticMarkup(<CollectionPanel board={board} onRefresh={()=>{}}/>);assert.match(html,/Awaiting safe-checkpoint response/);assert.match(html,/No saved context/);
 mergeImportedWork(board,[{itemId:'item',sourceIdentity:member.identity,ownerIdentity:member.identity,ownerHandle:member.terminalHandle,native:null,title:'Work',content:{prompt:'Scope',plan:'',design:'',implementationNotes:''},status:'running',observedAt:'today',references:[],dependencies:[],resultPath:null}]);
 const panel=renderToStaticMarkup(<ImportedTaskPanel board={board} node={board.nodes[1]} onEdit={()=>{}}/>);
 assert.match(panel,/Agent-reported/);assert.match(panel,/cooperative/);assert.match(panel,/codex:one/);assert.match(panel,/Pause owner/);
});
