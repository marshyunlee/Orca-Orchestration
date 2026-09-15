import { isGateUnresolved } from "../graphVisibility";
import type { Gate } from "../types";

export function GatePanel({ gates }: { gates: Gate[] }) {
  if (gates.length === 0) return null;
  return (
    <div className="gates">
      {gates.map(gate => (
        <div key={gate.id} className="gate">
          <div className="gate__badge">{isGateUnresolved(gate) ? "Decision pending" : "Decision recorded"}</div>
          <div className="gate__question">{gate.question}</div>
          <div className="gate__detail">Options: {gate.options.join(" · ")}</div>
          <div className="gate__detail">Status: {gate.status}{gate.resolution ? ` · ${gate.resolution}` : ""}</div>
          {isGateUnresolved(gate) && <div className="gate__detail">Respond in the coordinator conversation.</div>}
        </div>
      ))}
    </div>
  );
}
