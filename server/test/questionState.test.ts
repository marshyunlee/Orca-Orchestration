import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBoardSnapshot,createBoardNode,type BoardMessage,type AttemptRef} from '../../shared/board.js';
import {getQuestionState} from '../../shared/questions.js';
import type {ImportedWork} from '../../shared/imports.js';
import type {ComponentState} from '../../shared/collaborate.js';

test('settled questions retain answer uncertainty and never offer another reply',()=>{
 const board=createBoardSnapshot('board','Board',[],'');
 const question:BoardMessage={id:'q',author:'dispatch:dispatch',body:'Proceed?',createdAt:'now',nativeMessageId:'native',answered:false};
 assert.equal(getQuestionState(board,question),'pending');
 board.attempts.push({dispatchId:'dispatch',nativeStatus:'completed',stopped:false} as AttemptRef);
 assert.equal(getQuestionState(board,question),'settled');
 assert.equal(question.answered,false);
 const node=createBoardNode('import','task','Imported');
 node.imported={native:{dispatchId:'dispatch'},status:'dispatched'} as ImportedWork;board.nodes.push(node);
 question.importedNodeId=node.id;
 assert.equal(getQuestionState(board,question),'pending');
 node.imported.status='completed';assert.equal(getQuestionState(board,question),'settled');
 delete question.importedNodeId;question.componentNodeId='component';
 board.components.component={tasks:[{dispatchId:'dispatch',state:'failed'}]} as ComponentState;
 assert.equal(getQuestionState(board,question),'settled');
 question.answered=true;assert.equal(getQuestionState(board,question),'answered');
});
