import type { BoardSnapshot, BoardEdit } from "../../../shared/board.js";
export function RunPanel({board,onEdit,request,onRequest}:{board:BoardSnapshot;onEdit:(operation:BoardEdit)=>void;request:string;onRequest:(value:string)=>void}) {
  return <section className="run-conversation"><h3>Discussion & specification</h3><p>{board.specApproval?"Specification approved":"Specification is a draft"}</p>
    {board.discussionStatus && <p>Group {board.discussionStatus.status} · Cycle {board.discussionStatus.cycle}, round {board.discussionStatus.round} · {board.discussionStatus.remainingRounds} rounds and {Math.ceil(board.discussionStatus.remainingSeconds/60)} minutes remaining · {board.discussionStatus.outstanding} outstanding contributions</p>}
    {board.messages.map(message=><article key={message.id}><strong>{message.author}</strong><p className="preserve-lines">{message.body}</p>{message.nativeMessageId && !message.answered && <button onClick={()=>onEdit(message.componentNodeId?{kind:"component-question",nodeId:message.componentNodeId,messageId:message.nativeMessageId!,body:request}:{kind:"answer-question",messageId:message.nativeMessageId!,body:request})}>Send answer</button>}</article>)}
    <label>Request or feedback<textarea value={request} onChange={event=>onRequest(event.target.value)} placeholder="What would you like the group to work on?"/></label>
    <div className="board-actions"><button disabled={!request.trim()} onClick={()=>onEdit({kind:"discuss",body:request})}>Discuss with group</button><button onClick={()=>onEdit({kind:"approve-spec"})}>Approve spec</button><button disabled={!board.specApproval} onClick={()=>onEdit({kind:"generate-tasks",body:""})}>Generate tasks</button></div>
  </section>;
}
