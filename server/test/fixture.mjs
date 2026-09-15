// Manual browser fixture. It serves only synthetic Runs and never calls Orca.
import express from "express";
import { fileURLToPath } from "node:url";

const app = express();
app.use(express.json());
let config = { runId: "run_design", layout: "layered-lr" };
let state = { complete: false, fail: false, delayMs: 0 };
const runs = [
  { id: "run_design", objective: "Design and repair fixture", coordinator_handle: "term_design", created_at: "2026-09-15" },
  { id: "run_other", objective: "Other delivery fixture", coordinator_handle: "term_other", created_at: "2026-09-14" },
];
app.get("/api/config", (_request, response) => response.json(config));
app.put("/api/config", (request, response) => { config = { ...config, ...request.body }; response.json(config); });
app.get("/api/runs", (_request, response) => response.json({ runs }));
app.post("/__test/state", (request, response) => { state = { ...state, ...request.body }; response.json(state); });
app.get("/api/dag", (request, response) => {
  const captured = { ...state };
  const runId = String(request.query.run);
  const node = (id, label, status) => ({ id, label, status,
    spec: "Accepted specification: preserve the existing interface.",
    result: status === "completed" ? "Verified fixture evidence." : null,
    createdAt: "2026-09-15", completedAt: status === "completed" ? "2026-09-15" : null,
    dispatchId: status === "dispatched" ? "dispatch_fixture" : null,
    assigneeHandle: status === "dispatched" ? "term_fixture" : null });
  const dag = { runId, generatedAt: Date.now(),
    nodes: runId === "run_other" ? [node("other", "Other delivery only", "ready")] : [
      node("spec", "Accepted specification", "completed"),
      node("implementation", "Initial implementation", "completed"),
      node("repair", "Progressive repair", captured.complete ? "completed" : "dispatched"),
      node("history", "Older completed work", "completed"),
    ],
    edges: runId === "run_other" ? [] : [
      { id: "spec_implementation", source: "spec", target: "implementation" },
      { id: "implementation_repair", source: "implementation", target: "repair" },
    ],
    gates: runId === "run_other" || captured.complete ? [] : [
      { id: "decision", taskId: "repair", question: "Keep the current interface?", options: ["Keep", "Amend"], status: "pending", resolution: null },
    ],
  };
  setTimeout(() => captured.fail ? response.status(503).json({ error: "Fixture refresh unavailable" }) : response.json(dag), captured.delayMs);
});
app.use(express.static(fileURLToPath(new URL("../../web/dist", import.meta.url))));
app.listen(Number(process.env.PORT ?? 8891), "127.0.0.1", () => console.log("Fixture listening"));
