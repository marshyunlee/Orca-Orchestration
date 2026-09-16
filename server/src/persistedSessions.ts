import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {isRecord} from '../../shared/board.js';
export function resolvePersistedSession(row:{tab_id:string;source:string},terminal:{ptyId?:string;tabId?:string;leafId?:string;incarnationId?:string;executionHostId?:string}|undefined,state:unknown):string|null{
 if(!terminal?.ptyId || terminal.executionHostId!=='local' || terminal.tabId!==row.tab_id || !terminal.leafId || !terminal.incarnationId || !isRecord(state) || !isRecord(state.workspaceSession))return null;
 const workspace=state.workspaceSession;
 if(!isRecord(workspace.terminalPtyIncarnationsByPaneKey) || workspace.terminalPtyIncarnationsByPaneKey[`${terminal.tabId}:${terminal.leafId}`]!==terminal.incarnationId || !isRecord(workspace.tabsByWorktree))return null;
 const matches=Object.values(workspace.tabsByWorktree).flatMap(value=>Array.isArray(value)?value:[]).filter(tab=>isRecord(tab) && tab.id===row.tab_id && tab.ptyId===terminal.ptyId);
 if(matches.length!==1)return null;
 const title=matches[0].aiVaultTitle;
 return isRecord(title) && title.agent===row.source && typeof title.sessionId==='string' && /^[a-zA-Z0-9_-]+$/.test(title.sessionId)?title.sessionId:null;
}
export async function readPersistedSessions():Promise<unknown>{
 try{
  if(process.env.ORCA_SESSION_STATE)return JSON.parse(await readFile(process.env.ORCA_SESSION_STATE,'utf8'));
  if(process.platform!=='darwin')return null;
  const root=join(homedir(),'Library','Application Support','orca');
  const index=JSON.parse(await readFile(join(root,'orca-profile-index.json'),'utf8'));
  if(typeof index.activeProfileId!=='string' || !/^[a-zA-Z0-9_-]+$/.test(index.activeProfileId))return null;
  return JSON.parse(await readFile(join(root,'profiles',index.activeProfileId,'orca-data.json'),'utf8'));
 }catch{return null;}
}
