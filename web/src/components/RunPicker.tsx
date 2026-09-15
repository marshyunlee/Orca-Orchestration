import { useCallback, useEffect, useState } from "react";
import { fetchRuns } from "../api";
import type { OrcaRun } from "../types";
import { DoodleSelect } from "./DoodleSelect";

/** Select a native Run without taking its coordinator binding. */
export function RunPicker({
  runId,
  onPick,
  autoPick = true,
  disabled = false,
}: {
  runId: string;
  onPick: (id: string) => void;
  /** Gate for the newest-Run fallback. Off until the stored config has
   *  hydrated — auto-picking before that would overwrite the saved choice. */
  autoPick?: boolean;
  disabled?: boolean;
}) {
  const [runs, setRuns] = useState<OrcaRun[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchRuns();
      setRuns(next);
      setErr(null);
      // Nothing selected (or the stored Run is gone) → fall back to newest.
      if (autoPick && next.length > 0 && !next.some((r) => r.id === runId)) onPick(next[0].id);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }, [runId, onPick, autoPick]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [load]);

  const current = runs.find((r) => r.id === runId);

  return (
    <div className="runpick">
      <span className="toolbar-label">Run</span>
      <DoodleSelect
        value={runId}
        onChange={onPick}
        disabled={disabled || runs.length === 0}
        placeholder="(no Runs)"
        emptyText="(no Runs)"
        title={current ? `${current.id} · ${current.objective}` : "Pick a Run"}
        options={runs.map((r) => ({
          value: r.id,
          label: r.objective || r.id,
          hint: r.id,
        }))}
      />
      {err && <span className="runpick__error">⚠️ {err}</span>}
    </div>
  );
}
