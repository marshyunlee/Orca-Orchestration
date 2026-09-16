import {useState} from "react";
import {fetchBoardArtifact} from "../api.js";
import type { AttemptRef } from "../../../shared/board.js";
export function AttemptHistory({boardId,attempts}:{boardId:string;attempts:AttemptRef[]}) {
  const [artifact,setArtifact]=useState("");
  async function open(name:string){try{setArtifact(await fetchBoardArtifact(boardId,name));}catch(error){setArtifact(String(error));}}
  return <section><h3>Attempt history</h3>{attempts.length===0?<p>No execution has occurred.</p>:attempts.map(attempt=><details key={attempt.id}>
    <summary>Revision {attempt.nodeRevision} · {attempt.nativeStatus}</summary>
    <dl><dt>Task</dt><dd>{attempt.taskId}</dd><dt>Dispatch</dt><dd>{attempt.dispatchId || "Launch pending"}</dd><dt>Session</dt><dd>{attempt.assigneeHandle || "Not assigned yet"}</dd><dt>Workspace</dt><dd>{attempt.workspacePath}</dd><dt>Process</dt><dd>{attempt.ownsProcess?"Task-owned worker":"Existing member session"}</dd></dl>
    <button onClick={()=>void open(attempt.promptPath)}>Original prompt</button>{attempt.resultPath && <button onClick={()=>void open(attempt.resultPath!)}>Result</button>}{attempt.guidancePaths.map((path,index)=><button key={path} onClick={()=>void open(path)}>Guidance {index+1}</button>)}
  </details>)}{artifact && <pre className="preserve-lines">{artifact}</pre>}</section>;
}
