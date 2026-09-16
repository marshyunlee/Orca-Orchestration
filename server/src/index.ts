import express from "express";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { refreshNativeBoard, refreshDiscussionStatus, observationErrors } from "./nativeObservation.js";
import { createCoordinatorActions } from "./coordinatorActions.js";
import { createBoardStore } from "./boardStore.js";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { runOrca } from "./orca";
import { createViewerApp } from "./app";
import { loadEmbeddedAssets } from "./webAssets";
import { describeSkillInstall, installSkill } from "./skill";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 8787);
// Directory containing viewer preferences. It does not select worker placement.
const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? process.cwd();

// --- Subcommands ----------------------------------------------------------
// Handled before anything else so `uninstall` and `--help` never bind a port,
// create an Orca terminal, or install the skill on their way out.
const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`orca-dag — observe native Orca task history and dependencies

Usage:
  orca-dag                 install the orca-dag skill into your agents, then serve the viewer
  orca-dag uninstall       remove the skill and close leftover Orca terminals
  orca-dag --help          show this

Options:
  --no-skill               don't touch the agent skill directories on startup
  --purge                  (uninstall) also delete this workspace's .orca-dag.config.json
  --dry-run                (uninstall) report what would be removed, change nothing

Environment:
  PORT=8787                port to serve on
  NO_OPEN=1                don't open a browser tab
  ORCA_DAG_NO_SKILL=1      same as --no-skill
  WORKSPACE_DIR=<path>     directory containing viewer preferences`);
  process.exit(0);
}

if (argv.includes("uninstall")) {
  const { runUninstall } = await import("./uninstall");
  await runUninstall({
    dryRun: argv.includes("--dry-run"),
    purge: argv.includes("--purge"),
    workspace: WORKSPACE_DIR,
  });
  process.exit(0);
}

const tokenDirectory = process.env.ORCA_BOARD_RUNTIME ?? join(homedir(), ".local", "state", "orca-board");
await mkdir(tokenDirectory, {recursive:true, mode:0o700});
const tokenPath = join(tokenDirectory, `token-${PORT}`);
let token: string;
try { token = await readFile(tokenPath,"utf8"); }
catch(error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  token = randomBytes(32).toString("hex");
  await writeFile(tokenPath,token,{flag:"wx",mode:0o600});
}
await chmod(tokenPath,0o600);
const boardStore = await createBoardStore(process.env.ORCA_BOARD_ROOT ?? join(homedir(),"work-vault","sessions","orca-boards"));
const app = createViewerApp(WORKSPACE_DIR, {store:boardStore,token,developmentOrigin:process.env.ORCA_BOARD_DEV_ORIGIN});
process.env.ORCA_BOARD_CLI ??= existsSync(join(__dirname,"../../bin/boardctl.mjs")) ? `node ${JSON.stringify(join(__dirname,"../../bin/boardctl.mjs"))}` : `node --import tsx ${JSON.stringify(join(__dirname,"boardCli.ts"))}`;
const coordinatorActions=createCoordinatorActions(boardStore);
let checkingBoards=false;
const deliveryTimer=setInterval(()=>{
  if(checkingBoards)return;checkingBoards=true;
  void boardStore.list().then(async boards=>{
    for(const board of boards){
      const observed=await Promise.allSettled([refreshDiscussionStatus(board),refreshNativeBoard(boardStore,board.id)]);
      const errors=observed.filter(result=>result.status==="rejected").map(result=>String((result as PromiseRejectedResult).reason)).filter(error=>!error.includes("revision conflict"));
      if(errors.length)observationErrors.set(board.id,errors.join("; "));else observationErrors.delete(board.id);
      const queued=board.actions.find(action=>action.phase==="queued" && action.kind!=="launch" && (action.payload as {delivery?:string})?.delivery==="pending");
      if(queued)try{await coordinatorActions.deliver(board.id,queued.id);}catch(error){console.error("Board delivery:",String(error));}
    }
  }).catch(error=>console.error("Board refresh:",String(error))).finally(()=>{checkingBoards=false;});
},3000);
deliveryTimer.unref();
for (const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,()=>{void boardStore.close().finally(()=>process.exit(0));});

// --- Serve the built SPA -------------------------------------------------
// Two sources, in priority order:
//   1. assets embedded at `bun build --compile` time  → portable single binary
//   2. a `web/dist` folder on disk                     → plain `npm run build && npm start`
// In `npm run dev` neither is used: Vite serves the UI on :5173 and proxies /api.
let servingUI = false;
const embedded = await loadEmbeddedAssets();
if (embedded.size > 0) {
  const indexHtml = embedded.get("index.html");
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    const key = req.path.replace(/^\/+/, "") || "index.html";
    // Exact asset, else fall back to index.html for SPA client routes.
    const hit = embedded.get(key) ?? (extname(key) ? undefined : indexHtml);
    if (!hit) return next();
    res.setHeader("Content-Type", hit.type);
    res.setHeader("Cache-Control", key === "index.html" ? "no-cache" : "public, max-age=31536000, immutable");
    res.end(hit.body);
  });
  servingUI = true;
} else {
  const distDir = join(__dirname, "..", "..", "web", "dist");
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => res.sendFile(join(distDir, "index.html")));
    servingUI = true;
  }
}

// `orca-dag` is meant to be the single command that makes the whole project
// work, so starting the viewer also puts the DAG-building skill in front of
// whatever agents this machine has. Best-effort and idempotent — see skill.ts.
const skillReport = describeSkillInstall(
  await installSkill(__dirname, !argv.includes("--no-skill") && process.env.ORCA_DAG_NO_SKILL !== "1"),
);

app.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  if (skillReport) console.log(skillReport);
  console.log(`Orca DAG viewer → ${url}`);
  console.log(`Viewer preferences: ${WORKSPACE_DIR}`);
  if (servingUI && process.env.NO_OPEN !== "1") void openBrowser(url);
});

/**
 * Open the viewer URL. Prefers an Orca built-in browser tab (`orca tab create`)
 * so the DAG lives inside the Orca window next to the terminals/workers it
 * drives; falls back to the OS default browser when Orca isn't reachable (dev
 * from a non-worktree dir, Orca not yet open, tab creation refused). Best-effort:
 * never throws — the URL is already logged above.
 */
async function openBrowser(url: string): Promise<void> {
  // `tab create` resolves the current worktree from cwd, so it works wherever
  // the viewer runs inside an Orca-managed project. Fails fast if the runtime
  // isn't up — then we drop to the system browser below.
  try {
    const created = await runOrca<{ browserPageId?: string }>(["tab", "create", "--url", url]);
    // `tab create` makes the new tab the active one, but does NOT raise the
    // Orca window to the foreground. `tab switch --focus` reveals the window
    // (and the tab), so the DAG shows up in front instead of behind something.
    const pageId = created?.browserPageId;
    if (pageId) {
      try {
        await runOrca(["tab", "switch", "--page", pageId, "--focus"]);
      } catch {
        // Tab is created and active; only the window-raise failed — leave it.
      }
    }
    return;
  } catch {
    // Orca not running / not a worktree / tab refused — fall through.
  }
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // headless / no browser — the URL is already printed above
  }
}
