import type { BoardSnapshot } from '../../shared/board.js';

export function hasComponentWork(board:BoardSnapshot,nodeId:string):boolean {
  const state=board.components?.[nodeId];
  if(state?.launches.some(launch=>launch.phase!=='settled'))return true;
  if(state?.tasks.some(task=>task.dispatchId && !['report_received','released','completed','succeeded'].includes(task.state)))return true;
  return board.actions.some(action=>action.nodeId===nodeId && action.kind.startsWith('component-') && ['queued','claimed','unknown'].includes(action.phase));
}
