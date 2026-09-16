import express from "express";
import { localOrigin, requireToken } from "./localAuth.js";
import { createBoardRouter } from "./boardRoutes.js";
import type { BoardStore } from "./boardStore.js";
import { loadConfig, saveConfig } from "./config";
import { OrcaCliError, listGates, listRuns, listTasks, tasksToDag } from "./orca";

function failRequest(response: express.Response, error: unknown): void {
  const failure = error as OrcaCliError;
  const code = failure?.code ?? null;
  response.status(code === "run_required" || code === "run_not_found" ? 409 : 500)
    .json({ error: String(failure?.message ?? error), code });
}

/** HTTP observation never acquires a coordinator identity or consumes its inbox. */
export function createViewerApp(workspaceDir: string, boards?: {store: BoardStore; token: string; developmentOrigin?: string}): express.Express {
  const app = express();
  app.use(localOrigin(boards?.developmentOrigin));
  app.use(express.json({ limit: "2mb" }));
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, workspace: workspaceDir });
  });
  app.get("/api/runs", async (_request, response) => {
    try {
      response.json({ runs: await listRuns() });
    } catch (error) {
      failRequest(response, error);
    }
  });
  app.get("/api/dag", async (request, response) => {
    const runId = String(request.query.run ?? "").trim();
    if (!runId) {
      response.status(400).json({ error: "run query parameter required", code: "run_required" });
      return;
    }
    try {
      const [tasks, gates] = await Promise.all([listTasks(runId), listGates(runId)]);
      response.json({ runId, ...tasksToDag(tasks), gates, generatedAt: Date.now() });
    } catch (error) {
      failRequest(response, error);
    }
  });
  app.get("/api/config", async (_request, response) => {
    response.json(await loadConfig(workspaceDir));
  });
  if (boards) {
    app.get("/api/auth", (_request,response)=>response.json({token:boards.token}));
    app.use("/api/boards",createBoardRouter(boards.store,boards.token));
    app.use("/api/config", (request,response,next)=> request.method === "GET" ? next() : requireToken(boards.token)(request,response,next));
  }
  app.put("/api/config", async (request, response) => {
    try {
      response.json(await saveConfig(workspaceDir, request.body ?? {}));
    } catch (error) {
      failRequest(response, error);
    }
  });
  // Keep missing API routes out of the SPA's HTML fallback.
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found" });
  });
  return app;
}
