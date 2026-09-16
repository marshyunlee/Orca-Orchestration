import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoardStore } from '../src/boardStore.js';
import { createBoardNode } from '../../shared/board.js';
import { createExecutionBridge } from '../src/executionBridge.js';
import { digestNodeInput, digestSpec } from '../src/boardGraph.js';

test('a direct successor freezes a component result without a cross-Run native Task dependency',async()=>{
 const root=await mkdtemp(join(tmpdir(),'component-deps-')),store=await createBoardStore(root);
 try{
  let board=await store.create({title:'Fixture',members:[],coordinatorIdentity:''},'create');
  board=await store.update(board.id,board.revision,'setup',current=>{
    const component=createBoardNode('component','task','Component');component.collaborate={masterIdentity:'codex:master',manifestPath:'/manifest.json'};
    const integration=createBoardNode('integration','task','Integration');integration.assignment={kind:'new-worker',agent:'codex',workspacePath:'/fixture'};
    current.nodes[0].content.design='Approved root behavior: preserve case and internal whitespace';
    current.nodes.push(component,integration);current.edges=[{id:'dependency',source:component.id,target:integration.id}];
    current.components.component={masterIdentity:'codex:master',manifestPath:'/manifest.json',manifestDigest:'manifest',runId:'run_component',featureWorkspace:'/feature',phase:'completed',gate:{baselineSha:'base',overlayDigest:'overlay',commands:['test'],setup:{},humanChecks:[],selectionPolicy:[],deliveryScope:'feature',featureCloseRequested:false,repairPolicy:{}},gateDigest:'gate',approvals:[],tasks:[],observedAt:'now',launches:[],result:{id:'selection',nodeRevision:1,gateDigest:'gate',candidateId:'impl-opus',snapshotDigest:'snapshot',artifactPath:'selection-artifact',digest:'result-digest'}};
    current.specApproval={nodeRevision:1,digest:digestSpec(current)};current.acceptedNodeDigests.integration=digestNodeInput(current,'integration');current.implementationRunId='run_parent';current.pauseNewStarts=false;return current;
  });
  await store.artifact(board.id,'selection-artifact',JSON.stringify({selection:{path:'/run/outcome/label.json',digest:'selected-content-digest'}}));
  const bridge=createExecutionBridge(store);
  const permit=await bridge.admitLaunch(board.id,'integration',1,'launch');
  const operation=await bridge.beginOperation(board.id,'launch');
  assert.equal(operation.operation.kind,'create-task');
  if(operation.operation.kind==='create-task')assert.deepEqual(operation.operation.dependencies,[]);
  const prompt=await store.readArtifact(board.id,permit.promptPath);
  assert.match(prompt,/result-digest/);
  assert.match(prompt,/Approved root behavior: preserve case and internal whitespace/);
  assert.match(prompt,/selected-content-digest/);
  assert.match(prompt,/\/run\/outcome\/label.json/);
  const current=await store.read(board.id);
  assert.equal(current.attempts[0].dependencyEvidence?.[0].evidenceId,'selection');
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
