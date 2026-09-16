import type { AttemptRef } from "../../../shared/board.js";
export function AttemptHistory({attempts}:{attempts:AttemptRef[]}) {
  return <section><h3>Attempt history</h3>{attempts.length===0?<p>No execution has occurred.</p>:attempts.map(attempt=><details key={attempt.id}>
    <summary>Revision {attempt.nodeRevision} · {attempt.nativeStatus}</summary>
    <dl><dt>Task</dt><dd>{attempt.taskId}</dd><dt>Dispatch</dt><dd>{attempt.dispatchId || "Launch pending"}</dd><dt>Session</dt><dd>{attempt.assigneeHandle || "Not assigned yet"}</dd><dt>Workspace</dt><dd>{attempt.workspacePath}</dd><dt>Process</dt><dd>{attempt.ownsProcess?"Task-owned worker":"Existing member session"}</dd></dl>
    <p>Original prompt: {attempt.promptPath}</p>{attempt.resultPath && <p>Result: {attempt.resultPath}</p>}
  </details>)}</section>;
}
