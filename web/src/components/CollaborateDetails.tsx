import {useState} from 'react';
import type {BoardSnapshot,BoardNode,BoardEdit} from '../../../shared/board.js';
import {boardRequest,fetchBoardArtifact} from '../api.js';

export function CollaborateDetails({board,node,onEdit,onSnapshot,readOnly=false}:{board:BoardSnapshot;node:BoardNode;onEdit:(operation:BoardEdit)=>void;onSnapshot:(board:BoardSnapshot)=>void;readOnly?:boolean}) {
 const [body,setBody]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[evidence,setEvidence]=useState('');
 const state=board.components[node.id];
 const approval=state?.approvals.find(item=>item.digest===state.gateDigest && item.nodeRevision===node.revision);
 const selected=state?.result?.nodeRevision===node.revision && state.result.gateDigest===state.gateDigest?state.result:null;
 async function approve(){
  if(!state)return;setBusy(true);setError('');
  try{onSnapshot(await boardRequest<BoardSnapshot>(`/api/boards/${board.id}/components/${node.id}/approve`,{actionId:crypto.randomUUID(),digest:state.gateDigest,source:{kind:'ui',reference:`${board.id}/${board.deliveryId}/${node.id}`,response:'Approve this gate'}}));}catch(error){setError(String(error));}finally{setBusy(false);}
 }
 return <details className="collaborate-details" open><summary>Collaborate details · {selected?'Selected result accepted':state?.phase??'Awaiting master preparation'}</summary>
  <p>Master: {board.members.find(member=>member.identity===node.collaborate?.masterIdentity)?.tabName??node.collaborate?.masterIdentity}</p>
  <p>Manifest: {node.collaborate?.manifestPath}</p>
  {state && <><p>Run: {state.runId} · Last observed {state.observedAt}</p>
   <details open><summary>Gate package · {approval?'Approved':'Needs approval'}</summary><pre className="preserve-lines">{JSON.stringify(state.gate,null,2)}</pre><p>Digest: {state.gateDigest}</p>{approval && <p>Approved via {approval.source.kind}: {approval.source.response}</p>}{!readOnly && !approval && <button disabled={busy} onClick={()=>void approve()}>Approve this gate</button>}</details>
   {selected && <p>Selected {selected.candidateId} · Snapshot {selected.snapshotDigest}</p>}
   <details open><summary>Implementations, cross-reviews and repairs · {state.tasks.length}</summary>{state.tasks.map(task=><article key={task.taskId}><strong>{task.kind} · {task.candidateId??'Feature'}</strong><p>{task.state} · Task {task.taskId} · Dispatch {task.dispatchId??'Not dispatched'}</p><p>Brief source: {task.briefPath??'Not published'}</p><p>Report: {task.reportPath??'Pending'}</p>{!readOnly && (['briefArtifact','reportArtifact'] as const).map(field=>task[field] && <button key={field} onClick={()=>void fetchBoardArtifact(board.id,task[field]!).then(setEvidence).catch(error=>setError(String(error)))}>Read saved {field==='briefArtifact'?'brief':'report'}</button>)}</article>)}</details>
   <details><summary>Launch history · {state.launches.length}</summary>{state.launches.map(launch=><article key={launch.request.launchId}><p>{launch.request.role} · {launch.phase} · Revision {launch.nodeRevision}</p><p>{launch.dispatchId??'No confirmed Dispatch'} · {launch.requestId??'No recorded request'}</p><p>Journal: {launch.request.journalPath}</p></article>)}</details>
   {!readOnly && selected && <button onClick={()=>void fetchBoardArtifact(board.id,selected.artifactPath).then(setEvidence).catch(error=>setError(String(error)))}>Inspect selection evidence</button>}
   {evidence && <pre className="preserve-lines">{evidence}</pre>}
  </>}
  {board.messages.filter(message=>message.componentNodeId===node.id).map(message=><article key={message.id}><p>{message.body}</p>{!readOnly && !message.answered && <button disabled={!body.trim()} onClick={()=>onEdit({kind:'component-question',nodeId:node.id,messageId:message.nativeMessageId!,body})}>Send answer to component</button>}</article>)}
  {!readOnly && <><label>Guidance or stop instructions<textarea value={body} onChange={event=>setBody(event.target.value)} placeholder="Describe the change or the child to stop."/></label><div className="board-actions">
   <button onClick={()=>onEdit({kind:'component-start',nodeId:node.id,body:body||'Prepare or continue the approved component.'})}>Prepare / Continue</button>
   <button onClick={()=>onEdit({kind:'pause',nodeIds:[node.id]})}>Pause child starts</button>
   <button disabled={!body.trim()} onClick={()=>onEdit({kind:'component-guidance',nodeId:node.id,body})}>Send guidance</button>
   <button onClick={()=>onEdit({kind:'component-stop',nodeId:node.id,body:body||'Stop active children and preserve their evidence. Prepare the saved revision for an explicitly approved rerun.'})}>Stop and prepare rerun</button>
   <button onClick={()=>onEdit({kind:'component-reconcile',nodeId:node.id,body:body||'Reconcile existing journals and native receipts without duplicate starts.'})}>Reconcile</button>
  </div>{(board.pauseNewStarts || board.pausedNodeIds.includes(node.id)) && <p>Child starts paused. Use board Resume after reviewing changes.</p>}</>}
  {error && <p role="alert">{error}</p>}
 </details>;
}
