import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import type { MemberRef, AgentSource } from "../../shared/board.js";
import { runOrca, OrcaCliError } from "./orca.js";
const execute=promisify(execFile);
interface SessionCandidate { tab_name:string;tab_id:string;terminal_handle:string;source:string;session_id?:string;worktree_path:string;error?:string }
interface TerminalBinding {handle:string;agentIdentity?:string;connected:boolean;writable:boolean;incarnationId?:string;executionHostId?:string;orphaned?:boolean}
export interface SessionDiscovery { members:MemberRef[];unavailable:{tabName:string;terminalHandle:string;reason:string}[] }
export function projectSessions(rows:SessionCandidate[],terminals:TerminalBinding[]):SessionDiscovery {
  const result:SessionDiscovery={members:[],unavailable:[]};
  for(const row of rows){
    const terminal=terminals.find(terminal=>terminal.handle===row.terminal_handle);
    if(row.error || !row.session_id || !terminal?.connected || !terminal.writable || terminal.orphaned || !terminal.incarnationId || !terminal.executionHostId || terminal.agentIdentity!==row.source){
      result.unavailable.push({tabName:row.tab_name,terminalHandle:row.terminal_handle,reason:row.error??"Session binding is unavailable"});continue;
    }
    result.members.push({identity:`${row.source}:${row.session_id}`,source:row.source as AgentSource,sessionId:row.session_id,tabId:row.tab_id,tabName:row.tab_name,terminalHandle:row.terminal_handle,incarnationId:terminal.incarnationId,hostId:terminal.executionHostId,workspacePath:row.worktree_path});
  }
  return result;
}
const discoveryScript=String.raw`
import importlib.util,json,sys
from concurrent.futures import ThreadPoolExecutor
spec=importlib.util.spec_from_file_location('board_session_resolver',sys.argv[1])
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
options=json.loads(sys.argv[2])
inventory=helper.read_orca_result(['terminal','list','--include-visual-layouts'])
if inventory.get('truncated') or inventory.get('hostScope',{}).get('omittedHostIds'): raise ValueError('Session inventory is incomplete')
terminals={terminal['handle']:terminal for terminal in inventory.get('terminals',[])}
rows=[]
for layout in inventory.get('visualLayouts',[]):
 for tab in helper.collect_tab_bindings(layout):
  for handle in dict.fromkeys(helper.collect_terminal_handles(tab['panes'])):
   terminal=terminals.get(handle,{})
   if terminal.get('agentIdentity') not in ('codex','claude','cursor'): continue
   if options.get('handle') and handle != options['handle']: continue
   if options.get('names') and tab.get('title','').casefold() not in [name.casefold() for name in options['names']]: continue
   rows.append({'tab_name':tab.get('title',''),'tab_id':tab['tabId'],'terminal_handle':handle,'source':terminal.get('agentIdentity'),'worktree_path':layout.get('worktreePath','')})
with ThreadPoolExecutor(max_workers=min(len(rows),8) or 1) as pool:
 bindings=list(pool.map(helper.read_bound_session,rows))
for row,binding in zip(rows,bindings): row.update(binding)
fields=('handle','agentIdentity','connected','writable','incarnationId','executionHostId','orphaned')
print(json.dumps({'rows':rows,'terminals':[{key:terminal.get(key) for key in fields} for terminal in terminals.values()]}))
`;
export async function discoverGroupSessions(options:{handle?:string;names?:string[]}={}):Promise<SessionDiscovery>{
  const configured=process.env.ORCA_WORK_CONTEXT_HELPER;
  if(!configured)throw new Error("Session resolver unavailable: configure ORCA_WORK_CONTEXT_HELPER");
  const helper=await realpath(configured);
  const {stdout}=await execute(process.env.ORCA_BOARD_PYTHON??"python3",["-c",discoveryScript,helper,JSON.stringify(options)],{timeout:30000,maxBuffer:8*1024*1024});
  const result=JSON.parse(stdout);
  return projectSessions(result.rows,result.terminals);
}
export async function verifyGroupMember(member:MemberRef):Promise<MemberRef>{
  const result=await discoverGroupSessions({handle:member.terminalHandle});
  const verified=result.members.find(candidate=>candidate.identity===member.identity && candidate.incarnationId===member.incarnationId && candidate.hostId===member.hostId);
  if(!verified)throw new Error(`Session ${member.tabName} changed or disconnected; select its verified binding again`);
  return verified;
}
export async function isMemberIdle(member:MemberRef):Promise<boolean>{
  try{
    const result=await runOrca<{wait:{satisfied:boolean}}>(["terminal","wait","--terminal",member.terminalHandle,"--for","tui-idle","--timeout-ms","100"]);
    return result.wait.satisfied;
  }catch(error){if(error instanceof OrcaCliError && error.code==="timeout")return false;throw error;}
}
