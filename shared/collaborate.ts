export interface ComponentBinding {
  masterIdentity: string;
  manifestPath: string;
}

export function validateComponentBinding(value: unknown): asserts value is ComponentBinding | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object') throw new Error('Invalid collaborate binding');
  const binding = value as Record<string, unknown>;
  if (typeof binding.masterIdentity !== 'string' || !/^(codex|claude|cursor|other):.+$/.test(binding.masterIdentity)) {
    throw new Error('Component master identity required');
  }
  if (typeof binding.manifestPath !== 'string' || !binding.manifestPath.startsWith('/')) {
    throw new Error('Component manifest requires an absolute path');
  }
}

export interface GatePackage {
  baselineSha: string;
  overlayDigest: string;
  commands: string[];
  setup: unknown;
  humanChecks: string[];
  selectionPolicy: string[];
  deliveryScope: string;
  featureCloseRequested: boolean;
  repairPolicy: unknown;
}
export interface ApprovalSource { kind: 'ui' | 'chat'; reference: string; response: string }
export interface GateApproval { digest: string; nodeRevision: number; deliveryId: string; source: ApprovalSource; recordedAt: string; artifactPath: string }
export interface ComponentTask {
  taskId: string; kind: string; candidateId: string | null;
  dispatchId: string | null; terminalHandle: string | null;
  state: string; reportPath: string | null; briefPath: string | null;
  briefArtifact?: string; reportArtifact?: string;
}
export interface ComponentState {
  masterIdentity: string; manifestPath: string; manifestDigest: string;
  runId: string; featureWorkspace: string; phase: string;
  gate: GatePackage; gateDigest: string; approvals: GateApproval[];
  tasks: ComponentTask[]; observedAt: string; launches: ComponentLaunch[]; result: ComponentResult | null;
}

export interface ComponentLaunchRequest {
  identity: string; launchId: string; taskId: string; role: string;
  candidateId: string | null; journalPath: string;
}
export interface ComponentLaunch {
  request: ComponentLaunchRequest; requestDigest: string;
  nodeRevision: number; gateDigest: string;
  phase: 'prepared' | 'claimed' | 'ready' | 'failed' | 'unknown' | 'settled';
  requestId: string | null; dispatchId: string | null; receiptPath: string | null;
  dependencies: DependencyEvidence[];
}
export interface DependencyEvidence {
  nodeId: string; kind: 'direct' | 'component'; evidenceId: string; digest: string;
  taskId?: string; runId?: string; artifactPath?: string;
}
export interface ComponentResult {
  id: string; nodeRevision: number; gateDigest: string; candidateId: string;
  snapshotDigest: string; artifactPath: string; digest: string;
}

export interface ComponentResultRequest {
  identity: string; nodeRevision: number;
  selectionPath: string; candidateStatePath: string; gateResultPath: string;
}
