import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBoardSnapshot} from '../../shared/board.js';
import {mergeImportedWork} from '../src/importMerge.js';
import {validateImportedItem, type ImportedItem} from '../../shared/imports.js';
const item:ImportedItem={itemId:'task',sourceIdentity:'codex:source',ownerIdentity:'codex:owner',ownerHandle:'term_owner',native:{hostId:'local',runId:'run_one',taskId:'task_one',dispatchId:'dispatch_one'},title:'Original',content:{prompt:'scope',plan:'original plan',design:'',implementationNotes:''},status:'dispatched',observedAt:'2026-09-16T00:00:00Z',references:[],dependencies:[],resultPath:null};
test('native identity deduplicates contributors and advances observed dispatch',()=>{
 const board=createBoardSnapshot('board_test','Example',[],'');
 mergeImportedWork(board,[item,{...item,sourceIdentity:'claude:second',native:{...item.native!,dispatchId:'dispatch_two'}}]);
 assert.equal(board.nodes.length,2);assert.deepEqual(board.nodes[1].imported?.sourceIdentities,['codex:source','claude:second']);
 assert.equal(board.nodes[1].imported?.native?.dispatchId,'dispatch_two');
});
test('source refresh preserves human fields positions edges and removals',()=>{
 const board=createBoardSnapshot('board_test','Example',[],'');mergeImportedWork(board,[item]);
 const node=board.nodes[1];node.content.plan='Human plan';node.position={x:902,y:8};board.edges=[];
 mergeImportedWork(board,[{...item,title:'Updated',content:{...item.content,plan:'New source plan'}}]);
 assert.equal(node.title,'Updated');assert.equal(node.content.plan,'Human plan');assert.equal(node.imported?.proposals.plan,'New source plan');assert.deepEqual(node.position,{x:902,y:8});assert.deepEqual(board.edges,[]);
 node.removed=true;mergeImportedWork(board,[item]);assert.equal(board.nodes.length,2);assert.equal(node.removed,true);
});
test('narrative identity never merges similar prose from different authors',()=>{
 const board=createBoardSnapshot('board_test','Example',[],'');
 mergeImportedWork(board,[{...item,native:null},{...item,native:null,sourceIdentity:'claude:second'}]);assert.equal(board.nodes.length,3);
});
test('invalid or partially invented native identities are rejected',()=>{
 assert.throws(()=>validateImportedItem({...item,native:{runId:'run_one'}}),/native|hostId/i);
 assert.throws(()=>validateImportedItem({...item,status:3}),/status/i);
});
