import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CollaborateDetails} from '../src/components/CollaborateDetails.js';
import {createBoardNode,type BoardSnapshot} from '../../shared/board.js';
Object.assign(globalThis,{React});
test('component details expose exact gate, immutable worker evidence and historical read-only view',()=>{
 const node=createBoardNode('component','task','API');node.collaborate={masterIdentity:'codex:master',manifestPath:'/vault/manifest.json'};
 const board={id:'board',deliveryId:'delivery',members:[],messages:[],actions:[],pausedNodeIds:[],components:{component:{runId:'run_component',phase:'reviewing',gateDigest:'digest',manifestPath:'/vault/manifest.json',observedAt:'now',gate:{commands:['npm test'],humanChecks:['Inspect output'],selectionPolicy:['smaller diff'],repairPolicy:{max_rounds:2}},approvals:[],tasks:[{taskId:'review',kind:'review',candidateId:'opus',dispatchId:'dispatch_review',state:'ready',briefPath:'/vault/brief.md',reportPath:'/vault/report.json'}],launches:[],result:null}}} as unknown as BoardSnapshot;
 const render=(readOnly=false)=>renderToStaticMarkup(<CollaborateDetails board={board} node={node} readOnly={readOnly} onEdit={()=>{}} onSnapshot={()=>{}}/>);
 const html=render();
 for(const text of ['Collaborate details','npm test','Inspect output','Approve this gate','dispatch_review','/vault/brief.md','Send guidance'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(render(true),/<button|<textarea/);
});
