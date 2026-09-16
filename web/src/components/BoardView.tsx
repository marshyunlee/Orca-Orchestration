import { useEffect, useReducer, useRef, useState } from "react";
import type { BoardSnapshot, BoardEdit, NodeContent, Assignment } from "../../../shared/board.js";
import { boardRequest } from "../api.js";
import { createBoardViewState, reduceBoardView } from "../boardState.js";
import { GroupMembers } from "./GroupMembers.js";
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
  const [newGroup,setNewGroup]=useState(false),[title,setTitle]=useState("");
  const [connectionError,setConnectionError]=useState("");
  const [busy,setBusy]=useState(false);
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
  async function edit(operation:BoardEdit,savedDrafts:Record<string,string>={}) {
    if(!board || busy)return;
    const target=board;
    setBusy(true);
    try {
      const snapshot=await boardRequest<BoardSnapshot>(`/api/boards/${target.id}/edit`,{actionId:crypto.randomUUID(),baseRevision:target.revision,operation});
      dispatch({type:"save-succeeded",boardId:target.id,snapshot,savedDrafts});
    }catch(error){dispatch({type:"save-conflicted",boardId:target.id,error:String(error)});}
    finally{setBusy(false);}
  }
  function saveNode(title:string,content:NodeContent,assignment:Assignment|null) {
    if(!board || !node)return;
    const prefix=`${board.id}/${node.id}`;
    if(state.draftRevisions[prefix]!==undefined && state.draftRevisions[prefix]!==node.revision) {
      dispatch({type:"save-conflicted",boardId:board.id,error:"This node changed while you were editing. Your draft is preserved; compare the current revision before saving."});return;
    }
    void edit({kind:"edit-node",nodeId:node.id,title,content,assignment},Object.fromEntries(Object.entries(state.drafts).filter(([key])=>key.startsWith(prefix+"/"))));
  }
  async function createGroup() {
    setBusy(true);
    try {
      const snapshot=await boardRequest<BoardSnapshot>("/api/boards",{actionId:crypto.randomUUID(),title,members:[],coordinatorIdentity:""});
      dispatch({type:"save-succeeded",boardId:snapshot.id,snapshot,savedDrafts:{}});dispatch({type:"select",boardId:snapshot.id});setTitle("");setNewGroup(false);
    }catch(error){setConnectionError(String(error));}finally{setBusy(false);}
  }
  return <main className="board-app">
    <GroupTabs boards={Object.values(state.snapshotsById)} selectedId={state.selectedBoardId} onSelect={boardId=>dispatch({type:"select",boardId})} onCreate={()=>setNewGroup(true)} onHistory={onHistory}/>
    {newGroup && <form className="new-group" onSubmit={event=>{event.preventDefault();void createGroup();}}><label>Group name<input autoFocus value={title} onChange={event=>setTitle(event.target.value)}/></label><button disabled={busy || !title.trim()}>Create group</button><button type="button" onClick={()=>setNewGroup(false)}>Cancel</button></form>}
    {connectionError && <p role="alert" className="board-error">{connectionError}</p>}
    {board?<><header className="board-header"><h2>{board.title}</h2><span>{board.specApproval?"Spec approved":"Spec draft"} · Revision {board.revision}</span><span>{board.members.length} sessions</span></header>
      <GroupMembers key={board.id} board={board} onEdit={operation=>void edit(operation)}/><div className="board-toolbar"><button disabled={busy} onClick={()=>void edit({kind:"add-task",title:"New task"})}>+ Add task</button><button disabled={busy} onClick={()=>void edit({kind:"review-graph",body:""})}>Review graph / Update preview</button><button disabled={busy || !board.preview} onClick={()=>void edit({kind:"start"})}>Start</button><button disabled={busy} onClick={()=>void edit({kind:board.pauseNewStarts?"resume":"pause"})}>{board.pauseNewStarts?"Resume":"Pause new starts"}</button>{busy && <span>Saving…</span>}</div>
      {state.errors[board.id] && <p role="alert" className="board-error">{state.errors[board.id]}</p>}
      <div className="board-workspace"><div className="board-canvas"><BoardCanvas key={board.id} board={board} selectedId={node?.id??null} onSelect={nodeId=>dispatch({type:"select-node",nodeId})} onEdit={operation=>void edit(operation)}/></div>
        {node && <aside className="board-inspector">{node.kind==="preview"?<PreviewPanel node={node} onUpdate={()=>void edit({kind:"review-graph",body:""})}/>:<><TaskInspector board={board} node={node} drafts={state.drafts} onDraft={(section,value)=>dispatch({type:"edit-draft",boardId:board.id,nodeId:node.id,section,value})} onSave={saveNode} onDiscard={()=>dispatch({type:"discard-drafts",boardId:board.id,nodeId:node.id})} error={state.errors[board.id]}/>{node.kind==="run" && <RunPanel key={board.id} board={board} onEdit={operation=>void edit(operation)}/>}</>}</aside>}
      </div></>:<section className="board-empty"><h1>Your group workspace</h1><p>Create a group to begin with an editable Run, then develop its specification and task graph.</p><button onClick={()=>setNewGroup(true)}>+ New group</button></section>}
  </main>;
}
