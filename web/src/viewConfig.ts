import { useSyncExternalStore } from "react";
import { fetchConfig, saveConfig } from "./api";
import type { LayoutKind, ViewerConfig } from "./types";

const LAYOUT_KEY = "orca-dag:layout";
const RUN_KEY = "orca-dag:run-id";
let config: ViewerConfig = { layout: "", runId: "" };
const listeners = new Set<() => void>();
let persistTimer: number | null = null;

function emit(): void { for (const listener of listeners) listener(); }
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function getSnapshot(): ViewerConfig { return config; }
export function useConfig(): ViewerConfig {
  return useSyncExternalStore(subscribe, getSnapshot);
}
function readPreference(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function asLayout(value: unknown): LayoutKind | "" {
  return value === "layered-lr" || value === "layered-tb" || value === "force" ? value : "";
}
export async function initConfig(): Promise<void> {
  const stored = await fetchConfig();
  config = {
    layout: asLayout(stored.layout) || asLayout(readPreference(LAYOUT_KEY)),
    runId: typeof stored.runId === "string" ? stored.runId : readPreference(RUN_KEY),
  };
  emit();
}
function update(patch: Partial<ViewerConfig>): void {
  config = { ...config, ...patch };
  try {
    localStorage.setItem(LAYOUT_KEY, config.layout);
    localStorage.setItem(RUN_KEY, config.runId);
  } catch { /* The server file remains authoritative when browser storage is unavailable. */ }
  emit();
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    // Patch only view preferences, preserving saved execution choices on disk.
    saveConfig(config).catch(() => {});
  }, 250);
}

export function setLayout(layout: LayoutKind): void { update({ layout }); }
export function setRunId(runId: string): void { update({ runId }); }
