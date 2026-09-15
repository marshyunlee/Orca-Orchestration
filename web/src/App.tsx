import { useCallback, useEffect, useMemo, useState } from "react";
import { DagView } from "./components/DagView";
import { GatePanel } from "./components/GatePanel";
import { NodePanel } from "./components/NodePanel";
import { RunPicker } from "./components/RunPicker";
import { fetchDag } from "./api";
import { selectVisibleGraph } from "./graphVisibility";
import { initConfig, setLayout, setRunId, useConfig } from "./viewConfig";
import { LAYOUTS, STATUS_META, type DagResponse, type LayoutKind, type TaskStatus } from "./types";

const EMPTY: DagResponse = { runId: "", nodes: [], edges: [], gates: [], generatedAt: 0 };
const POLL_MS = 2000;

/**
 * Hand-drawn wobble filters — the whole "drawn with a crayon" illusion.
 *  - #crayon(-b/-c): a coarse waxy waver for node outlines, fills and stamps
 *    (objectBoundingBox — fine for boxes, breaks on zero-height lines). Three
 *    seeds of the same filter; flipping between them on a `steps(1)` keyframe
 *    loop is the classic hand-animation "boiling line". In doodle mode EVERY
 *    outline boils, phase-staggered per node so the flicks don't sync up.
 *  - #pencil-edge(-b/-c): same idea for edges, but in userSpaceOnUse with a
 *    deliberately oversized region so a perfectly horizontal edge (zero-height
 *    bbox) doesn't collapse the filter to nothing. All edges wear it — a DAG
 *    of clean beziers reads as software, a DAG of scrawls reads as a sketch.
 */
function HandDrawnDefs() {
  return (
    <svg className="crayon-defs" aria-hidden="true" focusable="false">
      <defs>
        {[
          ["crayon", 7],
          ["crayon-b", 23],
          ["crayon-c", 41],
        ].map(([id, seed]) => (
          <filter key={id} id={String(id)} x="-18%" y="-18%" width="136%" height="136%">
            {/* two frequencies: a slow bend (wonky hand) + a fine scratch (wax grain) */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.013 0.021"
              numOctaves="3"
              seed={seed}
              result="n"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale="9.5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
        {/* fine grain for small glyphs (the whale) — the coarse #crayon moves
            lines by ~9px, which turns a 44px drawing into mush */}
        {[
          ["crayon-fine", 5],
          ["crayon-fine-b", 17],
          ["crayon-fine-c", 31],
        ].map(([id, seed]) => (
          <filter key={id} id={String(id)} x="-12%" y="-12%" width="124%" height="124%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.06"
              numOctaves="2"
              seed={seed}
              result="n"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale="2.6"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
        {/* wax grain for the running node's scribble: a slow wobble warps the
            stroke, then a fine tooth noise bites translucent pits into it, so
            the stroke reads as crayon dragged over paper texture */}
        <filter id="crayon-fill" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.02"
            numOctaves="3"
            seed={13}
            result="wobble"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="wobble"
            scale="6"
            xChannelSelector="R"
            yChannelSelector="G"
            result="warped"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.5"
            numOctaves="2"
            seed={13}
            result="tooth"
          />
          <feColorMatrix
            in="tooth"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.1 0 0 0 0.3"
            result="toothAlpha"
          />
          <feComposite in="warped" in2="toothAlpha" operator="in" />
        </filter>
        {[
          ["pencil-edge", 11],
          ["pencil-edge-b", 29],
          ["pencil-edge-c", 53],
        ].map(([id, seed]) => (
          <filter
            key={id}
            id={String(id)}
            filterUnits="userSpaceOnUse"
            x="-8000"
            y="-8000"
            width="24000"
            height="24000"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.024"
              numOctaves="2"
              seed={seed}
              result="n"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale="4.5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </defs>
    </svg>
  );
}

export default function App() {
  const [storedDag, setDag] = useState<DagResponse>(EMPTY);
  const [showCompleted, setShowCompleted] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const config = useConfig();
  const runId = config.runId;
  const layout: LayoutKind = config.layout || "layered-lr";
  // bump to force a fresh auto-layout (discarding manual drags)
  const [reorgNonce, setReorgNonce] = useState(0);
  const dag = storedDag.runId === runId ? storedDag : EMPTY;
  const visibleDag = useMemo(() => selectVisibleGraph(dag, showCompleted), [dag, showCompleted]);

  // Hydrate layout and Run preferences before choosing a fallback Run.
  // once; RunPicker must not auto-pick a Run until this has settled, or its
  // fallback would overwrite the stored choice with "newest"
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    initConfig()
      .then(() => setHydrated(true))
      .catch(error => setConnError(`Preferences unavailable: ${String(error)}`));
  }, []);

  function pickLayout(kind: LayoutKind) {
    setLayout(kind);
  }

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const controller = new AbortController();
    setConnError(null);
    async function refresh() {
      if (!runId) return;
      try {
        const next = await fetchDag(runId, controller.signal);
        if (active) {
          setDag(next);
          setConnError(null);
        }
      } catch (error) {
        if (active) setConnError(String((error as Error).message ?? error));
      } finally {
        if (active) timer = window.setTimeout(refresh, POLL_MS);
      }
    }
    void refresh();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [runId]);

  // switching Run invalidates the current selection
  const pickRun = useCallback((id: string) => {
    setRunId(id);
    setSelectedId(null);
    setDag(EMPTY);
  }, []);

  const counts = dag.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.status] = (acc[n.status] ?? 0) + 1;
    return acc;
  }, {});

  const selected = visibleDag.nodes.find((n) => n.id === selectedId) ?? null;

  // the toolbar's bottom edge doubles as a crayon progress strip
  const total = dag.nodes.length || 1;
  const pctDone = ((counts.completed ?? 0) / total) * 100;
  const pctFail = ((counts.failed ?? 0) / total) * 100;
  const pctRun = ((counts.dispatched ?? 0) / total) * 100;

  return (
    <div className="app">
      <HandDrawnDefs />
      <header className="topbar">
        <div className="topbar__brand">
          {/* the mascot is drawn, not typeset — and it's an ORCA, not a whale:
              black body with the tall dorsal fin drawn into the outline, white
              belly, the signature white eye patch. Separate strokes like any
              doodle. */}
          <svg className="topbar__logo" viewBox="0 0 78 62" aria-hidden="true" focusable="false">
            <path
              className="orca__body"
              d="M7 36 C8 26 16 18 28 17 C30 12 33 7 38 4 C38 10 40 14 44 16 C52 18 56 24 57 30 C58 34 56 38 53 41 C44 49 22 51 13 46 C9 44 7 40 7 36 Z"
            />
            <path
              className="orca__tail"
              d="M54 38 C59 36 63 32 64 26 C65 30 65 34 63 37 C67 39 70 43 70 48 C65 46 59 44 53 42"
            />
            <path
              className="orca__belly"
              d="M9 37 C16 43 30 46 44 44 C49 43 52 42 53 41 C44 49 22 51 13 46 C10 44 8.7 40.5 9 37 Z"
            />
            <ellipse className="orca__patch" cx="20" cy="26.5" rx="6" ry="3" transform="rotate(-16 20 26.5)" />
            <circle className="orca__eye" cx="19" cy="27" r="1.8" />
            <path className="orca__flipper" d="M30 41 C33 44.5 37 45.5 41 44.5" />
            <path className="orca__smile" d="M10 39 C13 41.2 16 41.6 19 41" />
            <g className="orca__spout">
              <path d="M24 12 C24 8 24 5 23 2" />
              <path d="M22 12 C20 8 17 6 14 5" />
              <path d="M26 12 C29 8 31 7 33 6" />
            </g>
          </svg>
          <div>
            <div className="topbar__title">Orca DAG Viewer</div>
            <div className="topbar__subtitle">Group spec → supervised implementation → progressive increments</div>
          </div>
        </div>
        <span className="topbar__tape" aria-hidden="true" />
        <div className="topbar__right">
          <RunPicker runId={runId} onPick={pickRun} autoPick={hydrated} />
          <div
            className={`conn ${connError ? "conn--bad" : "conn--ok"}`}
            title={connError ? `Showing the last successful snapshot: ${connError}` : "Observing native Orca state"}
          >
            {connError ? "Refresh failed · data may be stale" : "Observing Orca"}
          </div>

        </div>
      </header>

      <div className="layout">
        <section className="pane pane--dag">
          <div className="dag-toolbar">
            <div className="legend">
              {(Object.keys(STATUS_META) as TaskStatus[]).map((s) => (
                <span
                  key={s}
                  className={`legend__item${counts[s] ? " legend__item--live" : ""}`}
                  data-status={s}
                >
                  <span className="legend__dot" style={{ background: STATUS_META[s].color }} />
                  {STATUS_META[s].label}
                  {/* keyed by value so the badge re-pops each time it changes */}
                  {counts[s] ? (
                    <b className="legend__n" key={counts[s]}>
                      {counts[s]}
                    </b>
                  ) : null}
                </span>
              ))}
            </div>
            <div className="dag-toolbar__right">
              <div className="layout-ctl">
                <span className="toolbar-label">Layout</span>
                <div className="seg" role="group" aria-label="Layout algorithm">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.kind}
                      className={layout === l.kind ? "active" : ""}
                      aria-pressed={layout === l.kind}
                      title={l.title}
                      onClick={() => pickLayout(l.kind)}
                    >
                      <span aria-hidden="true">{l.icon}</span> {l.label}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn--ghost"
                  title="Re-run auto-layout (discards manual drags)"
                  onClick={() => setReorgNonce((n) => n + 1)}
                >
                  ↻ Re-layout
                </button>
              </div>
              <span className="dag-toolbar__meta">
                {dag.nodes.length} tasks · {dag.edges.length} deps
              </span>
              <label className="history-toggle">
                <input type="checkbox" checked={showCompleted} onChange={event => {
                  setShowCompleted(event.target.checked);
                  setSelectedId(null);
                }} />
                Show completed tasks
              </label>
              {!showCompleted && <span className="dag-toolbar__meta">{dag.nodes.length - visibleDag.nodes.length} completed hidden</span>}

            </div>

            {/* the toolbar's bottom rule fills in with crayon as work lands */}
            <div className="dag-progress" aria-hidden="true">
              <span className="dag-progress__seg dag-progress__seg--done" style={{ width: `${pctDone}%` }} />
              <span className="dag-progress__seg dag-progress__seg--run" style={{ width: `${pctRun}%` }} />
              <span className="dag-progress__seg dag-progress__seg--fail" style={{ width: `${pctFail}%` }} />
            </div>
          </div>

          <div className="dag-canvas">
            {(showCompleted || visibleDag.nodes.length > 0 || dag.nodes.length === 0) && <DagView
              key={runId}
              dag={visibleDag}
              selectedId={selectedId}
              onSelect={setSelectedId}
              layout={layout}
              reorgNonce={reorgNonce}
            />}

            {!runId && (
              <div className="empty-run">
                <p className="empty-run__title">Pick a Run first</p>
                <p className="empty-run__body">
                  Since Orca 1.4.160 tasks belong to a Run — they are no longer global. Pick one with
                  the Run dropdown in the top-right, or have your agent run{" "}
                  <code>orca orchestration run-create</code> to start a new one.
                </p>
              </div>
            )}

            {!showCompleted && dag.nodes.length > 0 && visibleDag.nodes.length === 0 && (
              <div className="empty-run"><p>No active tasks. Show completed tasks to inspect history.</p></div>
            )}
            <GatePanel gates={dag.gates} />

            {/* keyed by node so switching selection replays the card's entrance */}
            {selected && (
              <NodePanel key={selected.id} node={selected} onClose={() => setSelectedId(null)} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
