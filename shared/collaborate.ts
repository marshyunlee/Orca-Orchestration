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
