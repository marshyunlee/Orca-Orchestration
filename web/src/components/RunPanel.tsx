import { useState } from "react";
import type { BoardSnapshot, BoardEdit } from "../../../shared/board.js";
export function RunPanel({board,onEdit}:{board:BoardSnapshot;onEdit:(operation:BoardEdit)=>void}) {
  const [request,setRequest]=useState("");
  return <section className="run-conversation"><h3>Discussion & specification</h3><p>{board.specApproval?"Specification approved":"Specification is a draft"}</p>
    {board.messages.map(message=><article key={message.id}><strong>{message.author}</strong><p className="preserve-lines">{message.body}</p>{message.nativeMessageId && !message.answered && <button onClick={()=>onEdit({kind:"answer-question",messageId:message.nativeMessageId!,body:request})}>Send answer</button>}</article>)}
    <label>Request or feedback<textarea value={request} onChange={event=>setRequest(event.target.value)} placeholder="What would you like the group to work on?"/></label>
    <div className="board-actions"><button disabled={!request.trim()} onClick={()=>onEdit({kind:"discuss",body:request})}>Discuss with group</button><button onClick={()=>onEdit({kind:"approve-spec"})}>Approve spec</button><button disabled={!board.specApproval} onClick={()=>onEdit({kind:"generate-tasks",body:""})}>Generate tasks</button></div>
  </section>;
}
