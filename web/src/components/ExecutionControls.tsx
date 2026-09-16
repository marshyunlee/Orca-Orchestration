import type {BoardSnapshot,BoardNode,BoardEdit} from "../../../shared/board.js";
export function ExecutionControls({board,node,onEdit}:{board:BoardSnapshot;node:BoardNode;onEdit:(operation:BoardEdit)=>void}){
 const attempt=board.attempts.filter(attempt=>attempt.nodeId===node.id).at(-1);
 if(!attempt)return null;
 const active=["admitted","ready","dispatched","unknown"].includes(attempt.nativeStatus);
 return <section className="execution-controls"><h3>Execution</h3><p>Attempt revision {attempt.nodeRevision} · {attempt.nativeStatus}. Editing revision {node.revision}.</p>
  {active && <><p>Saving changes holds downstream starts. Choose how the active task receives the change.</p><div className="board-actions"><button onClick={()=>onEdit({kind:"guidance",nodeId:node.id,body:"Apply the saved node revision and report what changed."})}>Send guidance</button><button onClick={()=>onEdit({kind:"stop-rerun",nodeId:node.id,body:"Stop this attempt and rerun the saved revision."})}>Stop and rerun</button></div></>}
  {board.pausedNodeIds.length>0 && <p>Downstream tasks remain paused until you explicitly Resume.</p>}
  {!attempt.ownsProcess && <p>This is an existing member session. Stop waits for the member to confirm its work has stopped.</p>}
 </section>;
}
