import {useState} from 'react';
import type {BoardSnapshot} from '../../../shared/board.js';
import {fetchBoardArtifact} from '../api.js';
export function CollectionPanel({board,onRefresh}:{board:BoardSnapshot;onRefresh:()=>void}){
 const [evidence,setEvidence]=useState(''),[error,setError]=useState('');
 async function show(path:string){try{setEvidence(await fetchBoardArtifact(board.id,path));setError('');}catch(error){setError(String(error));}}
 return <details className="collection-panel" open={board.collection?.requests.some(request=>!request.responsePath)}><summary>Existing session context · {board.collection?.requests.filter(request=>request.responsePath).length??0} summaries received</summary>
 <p>Saved context appears first. Agents respond at their next safe checkpoint; collecting work does not approve a new specification or pause existing execution.</p>
 <button onClick={onRefresh}>Refresh context and request summaries</button>
 {board.collection?.error && <p role="alert">{board.collection.error}</p>}
 {board.collection?.requests.map(request=><article key={request.id}><strong>{request.member.tabName}</strong> · {request.member.identity}<p>{request.savedCapturedAt?`Saved context captured ${request.savedCapturedAt}`:request.contextError??'Reading saved context…'}</p><p>{request.responsePath?`Summary received ${request.respondedAt}`:request.delivery==='unknown'?'Delivery uncertain; coordinator must reconcile original receipt':'Awaiting safe-checkpoint response'}</p>{((request.deliveryId && request.deliveryId!==board.deliveryId) || !board.members.some(member=>member.identity===request.member.identity && member.incarnationId===request.member.incarnationId)) && <p>Historical member binding</p>}{request.savedPath && <button onClick={()=>void show(request.savedPath!)}>Read saved context</button>}{request.responsePath && <button onClick={()=>void show(request.responsePath!)}>Read summary</button>}</article>)}
 {error && <p role="alert">{error}</p>}{evidence && <details open><summary>Source evidence <button onClick={()=>setEvidence('')}>Close</button></summary><pre className="preserve-lines">{evidence}</pre></details>}
 </details>;
}
