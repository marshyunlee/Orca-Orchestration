import { useState } from "react";
import type { BoardSnapshot, BoardEdit, MemberRef } from "../../../shared/board.js";
import { boardRequest } from "../api.js";
interface Discovery {members:MemberRef[];unavailable:{tabName:string;terminalHandle:string;reason:string}[]}
export function GroupMembers({board,onEdit}:{board:BoardSnapshot;onEdit:(operation:BoardEdit)=>void}){
  const [open,setOpen]=useState(false),[discovery,setDiscovery]=useState<Discovery>({members:[],unavailable:[]});
  const [selected,setSelected]=useState<MemberRef[]>([]),[coordinator,setCoordinator]=useState("");
  const [error,setError]=useState(""),[loading,setLoading]=useState(false);
  async function refresh(){setLoading(true);try{setDiscovery(await boardRequest<Discovery>("/api/sessions"));setError("");}catch(error){setError(String(error));}finally{setLoading(false);}}
  return <section className="group-members"><div className="member-chips">{board.members.map(member=><span key={member.identity} title={`${member.identity}\n${member.workspacePath}`}>{member.tabName} · {member.source}{board.coordinatorIdentity===member.identity?" · coordinator":""}</span>)}<button onClick={()=>{setOpen(!open);setSelected(board.members);setCoordinator(board.coordinatorIdentity);if(!open)void refresh();}}>Manage sessions</button></div>
    {open && <div className="member-picker"><h3>Group sessions</h3><p>Select exact sessions. Tab names can be duplicated.</p>{loading && <p>Reading live session bindings…</p>}
      {discovery.members.map(member=><label key={`${member.identity}/${member.terminalHandle}`} className="member-option"><input type="checkbox" checked={selected.some(item=>item.identity===member.identity && item.terminalHandle===member.terminalHandle)} onChange={event=>setSelected(current=>event.target.checked?[...current.filter(item=>item.identity!==member.identity),member]:current.filter(item=>item.identity!==member.identity))}/><span>{member.tabName} · {member.source}<small>{member.sessionId} · {member.workspacePath}</small></span></label>)}
      {selected.filter(member=>!discovery.members.some(candidate=>candidate.identity===member.identity && candidate.terminalHandle===member.terminalHandle)).map(member=><p key={member.identity}>{member.tabName} is currently unavailable. <button onClick={()=>setSelected(current=>current.filter(item=>item.identity!==member.identity))}>Remove selection</button></p>)}
      {discovery.unavailable.map(member=><p className="unavailable-member" key={member.terminalHandle}>{member.tabName}: {member.reason}</p>)}
      <label>Coordinator<select value={coordinator} onChange={event=>setCoordinator(event.target.value)}><option value="">Select coordinator</option>{selected.map(member=><option key={member.identity} value={member.identity}>{member.tabName} · {member.sessionId}</option>)}</select></label>
      {coordinator && coordinator!==board.coordinatorIdentity && board.coordinatorIdentity && <p>Saving requests a coordinator handover after outstanding control work settles.</p>}
      {error && <p role="alert">{error}</p>}<div className="board-actions"><button disabled={loading || !selected.some(member=>member.identity===coordinator)} onClick={()=>{onEdit({kind:"members",members:selected,coordinatorIdentity:coordinator});setOpen(false);}}>Save membership</button><button onClick={()=>void refresh()}>Refresh sessions</button><button onClick={()=>setOpen(false)}>Cancel</button></div>
    </div>}
  </section>;
}
