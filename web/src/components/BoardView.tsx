import type { ComponentBinding } from "../../../shared/collaborate.js";
import { CollaborateDetails } from "./CollaborateDetails.js";
import { useEffect, useReducer, useRef, useState } from "react";
import type { BoardSnapshot, BoardEdit, NodeContent, Assignment } from "../../../shared/board.js";
import { boardRequest,fetchBoardArtifact } from "../api.js";
import { createBoardViewState, reduceBoardView } from "../boardState.js";
import {ImplementationEditor} from "./ImplementationEditor.js";
import { ExecutionControls } from "./ExecutionControls.js";
import { GroupMembers } from "./GroupMembers.js";
import {AttemptHistory} from "./AttemptHistory.js";
import { GroupTabs } from "./GroupTabs.js";
import { BoardCanvas } from "./DagView.js";
import { TaskInspector } from "./TaskInspector.js";
import { RunPanel } from "./RunPanel.js";
import { PreviewPanel } from "./PreviewPanel.js";

export function BoardView({onHistory}:{onHistory:()=>void}) {
  const [state,dispatch]=useReducer(reduceBoardView,undefined,()=>{
    const initial=createBoardViewState();
    try {const saved=JSON.parse(localStorage.getItem("orca-board-drafts")??"{}");initial.drafts=saved.drafts??{};initial.draftRevisions=saved.draftRevisions??{};}catch{/* A corrupt browser draft does not replace stored boards. */}
    return initial;
  });
  const current=useRef(state); current.current=state;
  const sequence=useRef(0);
  const editQueue=useRef(Promise.resolve());
  const [newGroup,setNewGroup]=useState(false),[title,setTitle]=useState("");
  const [connectionError,setConnectionError]=useState("");
  const [busy,setBusy]=useState(false);
  const [historical,setHistorical]=useState<BoardSnapshot|null>(null);
  const board=state.selectedBoardId?state.snapshotsById[state.selectedBoardId]:null;
  const node=board?.nodes.find(node=>node.id===state.selectedNodeId && !node.removed)??board?.nodes.find(node=>node.kind==="run");
  useEffect(()=>{localStorage.setItem("orca-board-drafts",JSON.stringify({drafts:state.drafts,draftRevisions:state.draftRevisions}));},[state.drafts,state.draftRevisions]);
  useEffect(()=>{
    let active=true;
    const controller=new AbortController();
    async function refresh() {
      const requestSequence=++sequence.current;
      for(const id of Object.keys(current.current.snapshotsById)) dispatch({type:"load-started",boardId:id,requestSequence});
      try {
        const result=await boardRequest<{boards:BoardSnapshot[]}>("/api/boards",undefined,controller.signal);
        if(!active)return;
        for(const snapshot of result.boards) dispatch({type:"load-succeeded",boardId:snapshot.id,requestSequence,snapshot});
        if(!current.current.selectedBoardId && result.boards[0])dispatch({type:"select",boardId:result.boards[0].id});
        setConnectionError("");
      }catch(error){if(active)setConnectionError(`Refresh failed; showing saved data. ${String(error)}`);}
    }
    void refresh();const timer=window.setInterval(()=>void refresh(),2500);
    return ()=>{active=false;controller.abort();window.clearInterval(timer);};
  },[]);
  function edit(operation:BoardEdit,savedDrafts:Record<string,string>={}) {
    if(!board)return;
    const targetId=board.id;
    const pending=editQueue.current.then(async()=>{
      setBusy(true);
      try {
        const target=current.current.snapshotsById[targetId];
        const snapshot=await boardRequest<BoardSnapshot>(`/api/boards/${targetId}/edit`,{actionId:crypto.randomUUID(),baseRevision:target.revision,operation});
        current.current={...current.current,snapshotsById:{...current.current.snapshotsById,[targetId]:snapshot}};
        dispatch({type:"save-succeeded",boardId:targetId,snapshot,savedDrafts});
      }catch(error){dispatch({type:"save-conflicted",boardId:targetId,error:String(error)});}
      finally{setBusy(false);}
    });
    editQueue.current=pending;return pending;
  }
  function saveNode(title:string,content:NodeContent,assignment:Assignment|null,collaborate?:ComponentBinding) {
    if(!board || !node)return;
    const prefix=`${board.id}/${node.id}`;
    if(state.draftRevisions[prefix]!==undefined && state.draftRevisions[prefix]!==node.revision) {
      dispatch({type:"save-conflicted",boardId:board.id,error:"This node changed while you were editing. Your draft is preserved; compare the current revision before saving."});return;
    }
    void edit({kind:"edit-node",nodeId:node.id,title,content,assignment,collaborate},Object.fromEntries(Object.entries(state.drafts).filter(([key])=>key.startsWith(prefix+"/"))));
  }
  async function createGroup() {
    setBusy(true);
    try {
      const snapshot=await boardRequest<BoardSnapshot>("/api/boards",{actionId:crypto.randomUUID(),title,members:[],coordinatorIdentity:""});
      dispatch({type:"save-succeeded",boardId:snapshot.id,snapshot,savedDrafts:{}});dispatch({type:"select",boardId:snapshot.id});setTitle("");setNewGroup(false);
    }catch(error){setConnectionError(String(error));}finally{setBusy(false);}
  }
  return <main className="board-app">
    {historical && <section className="delivery-history" role="dialog" aria-label="Past delivery"><button onClick={()=>setHistorical(null)}>Close history</button><h2>{historical.title} · past delivery</h2><p>Recorded revision {historical.revision}. Historical contents are read-only.</p>{historical.nodes.map(item=><details key={item.id}><summary>{item.kind} · {item.title}</summary><pre className="preserve-lines">{Object.entries(item.content).map(([key,value])=>`${key}:\n${value}`).join("\n\n")}</pre></details>)}{historical.nodes.filter(item=>item.collaborate).map(item=><CollaborateDetails key={item.id} board={historical} node={item} readOnly onEdit={()=>{}} onSnapshot={()=>{}}/>)}<AttemptHistory boardId={historical.id} attempts={historical.attempts}/></section>}

    <GroupTabs boards={Object.values(state.snapshotsById)} selectedId={state.selectedBoardId} onSelect={boardId=>dispatch({type:"select",boardId})} onCreate={()=>setNewGroup(true)} onHistory={onHistory}/>
    {newGroup && <form className="new-group" onSubmit={event=>{event.preventDefault();void createGroup();}}><label>Group name<input autoFocus value={title} onChange={event=>setTitle(event.target.value)}/></label><button disabled={busy || !title.trim()}>Create group</button><button type="button" onClick={()=>setNewGroup(false)}>Cancel</button></form>}
    {connectionError && <p role="alert" className="board-error">{connectionError}</p>}
    {board?<><header className="board-header"><h2>{board.title}</h2><span>{board.specApproval?"Spec approved":"Spec draft"} · Revision {board.revision}{board.preview && !board.preview.current?" · Preview out of date":""}</span><span>{board.members.length} sessions</span><button disabled={busy} onClick={()=>void edit({kind:"new-delivery"})}>New increment</button>{board.history.length>0 && <select aria-label="Delivery history" value="" onChange={event=>{if(event.target.value)void fetchBoardArtifact(board.id,event.target.value).then(text=>setHistorical(JSON.parse(text))).catch(error=>setConnectionError(String(error)));}}><option value="">Past deliveries</option>{board.history.map((item,index)=><option key={item.deliveryId} value={item.snapshotPath}>Delivery {index+1}</option>)}</select>}</header>
      <GroupMembers key={board.id} board={board} onEdit={operation=>void edit(operation)}/><div className="board-toolbar"><button disabled={busy} onClick={()=>void edit({kind:"add-task",title:"New task"})}>+ Add task</button><button disabled={busy} onClick={()=>void edit({kind:"review-graph",body:""})}>Review graph / Update preview</button><button disabled={busy || !board.preview?.current} onClick={()=>void edit({kind:"start"})}>Start</button><button disabled={busy} onClick={()=>void edit({kind:board.pauseNewStarts?"resume":"pause"})}>{board.pauseNewStarts?"Resume":"Pause new starts"}</button>{!board.pauseNewStarts && board.pausedNodeIds.length>0 && <button disabled={busy} onClick={()=>void edit({kind:"resume"})}>Resume paused tasks</button>}{busy && <span>Saving…</span>}</div>
      <p className="board-edit-help">Drag nodes to arrange them. Connect a right dot to a left dot by dragging or clicking both. Select a task or edge and press Delete to remove it.</p>
      {board.observationError && <p role="alert" className="board-error">Group or native refresh failed; showing the last observed outcome. {board.observationError}</p>}
      {state.errors[board.id] && <p role="alert" className="board-error">{state.errors[board.id]}</p>}
      <details className="board-action-history"><summary>Actions · {board.actions.filter(action=>action.phase!=="applied").length} pending or needing attention</summary>{board.actions.map(action=><article key={action.id}><strong>{action.kind}</strong> · {action.phase}{action.requestId && <small> · {action.requestId}</small>}{action.error && <p role="alert">{action.error}</p>}{action.phase==="unknown" && <button onClick={()=>void edit({kind:"reconcile",targetActionId:action.id})}>Request reconciliation</button>}</article>)}</details><div className="board-workspace"><div className="board-canvas"><BoardCanvas key={board.id} board={board} selectedId={node?.id??null} onSelect={nodeId=>dispatch({type:"select-node",nodeId})} onEdit={operation=>void edit(operation)}/></div>
        {node && <aside className="board-inspector">{node.kind==="preview"?<PreviewPanel board={board} node={node} onUpdate={()=>void edit({kind:"review-graph",body:""})}/>:<><TaskInspector implementation={node.kind==="task"?<ImplementationEditor key={`${board.id}/${node.id}`} board={board} node={node} onSnapshot={snapshot=>dispatch({type:"save-succeeded",boardId:board.id,snapshot,savedDrafts:{}})} onEdit={operation=>void edit(operation)}/>:undefined} board={board} node={node} drafts={state.drafts} onDraft={(section,value)=>dispatch({type:"edit-draft",boardId:board.id,nodeId:node.id,section,value})} onReconcile={()=>dispatch({type:"reconcile-draft",boardId:board.id,nodeId:node.id,revision:node.revision})} onSave={saveNode} onDiscard={()=>dispatch({type:"discard-drafts",boardId:board.id,nodeId:node.id})} error={state.errors[board.id]}/>{node.kind==="task" && (node.collaborate?<CollaborateDetails board={board} node={node} onEdit={operation=>void edit(operation)} onSnapshot={snapshot=>dispatch({type:"save-succeeded",boardId:board.id,snapshot,savedDrafts:{}})}/>:<ExecutionControls board={board} node={node} onEdit={operation=>void edit(operation)}/>)}
{node.kind==="run" && <RunPanel key={board.id} board={board} request={state.drafts[`${board.id}/discussion/request`]??""} onRequest={value=>dispatch({type:"edit-draft",boardId:board.id,nodeId:"discussion",section:"request",value})} onEdit={operation=>void edit(operation)}/>}</>}</aside>}
      </div></>:<section className="board-empty"><h1>Your group workspace</h1><p>Create a group to begin with an editable Run, then develop its specification and task graph.</p><button onClick={()=>setNewGroup(true)}>+ New group</button></section>}
  </main>;
}
