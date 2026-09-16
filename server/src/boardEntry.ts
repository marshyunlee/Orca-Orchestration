import type { BoardSnapshot, MemberRef } from '../../shared/board.js';

export function resolveBoardEntry(boards: BoardSnapshot[], selector: {id?: string; title?: string}): BoardSnapshot {
  if (!selector.id && !selector.title) throw new Error('An explicit board ID or title is required');
  const matches = boards.filter(board => selector.id ? board.id === selector.id : board.title === selector.title);
  if (!matches.length) throw new Error('Board not found');
  if (matches.length !== 1) throw new Error(`Board title is ambiguous: ${matches.map(board=>board.id).join(', ')}`);
  return matches[0];
}

export function resolveEntryMembers(inventory: MemberRef[], names: string[], callerHandle: string): MemberRef[] {
  if (!Array.isArray(names) || names.some(name=>typeof name !== 'string' || !name.trim())) throw new Error('Session names must be nonempty text');
  const caller = inventory.find(member=>member.terminalHandle === callerHandle);
  if (!caller) throw new Error('The calling session could not be verified');
  const selected = new Map([[caller.identity, caller]]);
  for (const name of names) {
    const matches = inventory.filter(member=>member.identity === name || member.tabName.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!matches.length) throw new Error(`Session not found: ${name}`);
    if (matches.length !== 1) throw new Error(`Session name is ambiguous: ${name}; choose ${matches.map(member=>member.identity).join(', ')}`);
    selected.set(matches[0].identity, matches[0]);
  }
  return [...selected.values()];
}

export function resolveEntryRole(board: BoardSnapshot, callerHandle: string): {identity: string; role: 'coordinator' | 'component-master' | 'owner' | 'member'; nodeIds: string[]} {
  const member = board.members.find(member=>member.terminalHandle === callerHandle);
  if (!member) throw new Error('The caller is not a verified board member');
  const nodeIds = board.nodes.filter(node=>!node.removed && node.collaborate?.masterIdentity === member.identity).map(node=>node.id);
  const importedNodes=board.nodes.filter(node=>!node.removed && node.imported?.ownerIdentity===member.identity).map(node=>node.id);
  return {identity:member.identity, role:member.identity === board.coordinatorIdentity ? 'coordinator' : nodeIds.length?'component-master':importedNodes.length?'owner':'member', nodeIds:[...nodeIds,...importedNodes]};
}
