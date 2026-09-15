import { STATUS_META, type DagNode } from "../types";

export function NodePanel({ node, onClose }: { node: DagNode; onClose: () => void }) {
  const meta = STATUS_META[node.status];
  return (
    <aside className="node-panel">
      <button className="node-panel__close" onClick={onClose} aria-label="Close">
        ✕
      </button>

      <div className="node-panel__status" style={{ color: meta.ink }}>
        <span className="dot" style={{ background: meta.color }} />
        {meta.label}
      </div>
      <h3 className="node-panel__title">{node.label}</h3>
      <div className="node-panel__id">
        <code>{node.id}</code>
      </div>

      {/* Orca tracks the running attempt as a Dispatch; task-list only carries
          these while the task is dispatched. */}
      {node.dispatchId && (
        <div className="node-panel__field">
          <span className="node-panel__key">Current Dispatch (this attempt)</span>
          <div className="node-panel__id">
            <code>{node.dispatchId}</code>
          </div>
          {node.assigneeHandle && (
            <span className="node-panel__hint">
              Worker terminal <code>{node.assigneeHandle}</code> · inspect output with{" "}
              <code>orca orchestration worker-read --dispatch {node.dispatchId}</code>
            </span>
          )}
        </div>
      )}

      <div className="node-panel__field">
        <span className="node-panel__key">Spec</span>
        <p className="node-panel__spec-ro">{node.spec}</p>
        <span className="node-panel__hint">
          Discuss changes with the coordinator. Revised work is recorded as a new task.
        </span>
      </div>

      {node.result && (
        <div className="node-panel__field">
          <span className="node-panel__key">Result</span>
          <pre className="node-panel__result">{node.result}</pre>
        </div>
      )}
    </aside>
  );
}
