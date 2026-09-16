import {useState} from 'react';
import type {BoardSnapshot,BoardEdit,MemberRef} from '../../../shared/board.js';
import {boardRequest} from '../api.js';
import {SessionPicker,type SessionInventory} from './SessionPicker.js';
export function GroupMembers({board,onEdit}:{board:BoardSnapshot;onEdit:(operation:BoardEdit)=>void}){
 const [open,setOpen]=useState(false),[inventory,setInventory]=useState<SessionInventory>({members:[],unavailable:[]});
 const [members,setMembers]=useState<MemberRef[]>([]),[coordinator,setCoordinator]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function refresh(){setLoading(true);try{setInventory(await boardRequest<SessionInventory>('/api/sessions'));setError('');}catch(error){setError(String(error));}finally{setLoading(false);}}
 return <section className="group-members"><div className="member-chips">{board.members.map(member=><span key={member.identity} title={`${member.identity}\n${member.workspacePath}`}>{member.tabName} · {member.source}{board.coordinatorIdentity===member.identity?' · coordinator':''}</span>)}<button onClick={()=>{setOpen(!open);setMembers(board.members);setCoordinator(board.coordinatorIdentity);if(!open)void refresh();}}>Manage sessions</button></div>
 {open && <div><h3>Group sessions</h3>{loading && <p>Reading live session bindings…</p>}<SessionPicker inventory={inventory} members={members} coordinatorIdentity={coordinator} onChange={(next,owner)=>{setMembers(next);setCoordinator(owner);}}/>{error && <p role="alert">{error}</p>}{coordinator!==board.coordinatorIdentity && board.coordinatorIdentity && <p>Coordinator handover preserves imported task owners.</p>}<button disabled={loading || !members.some(member=>member.identity===coordinator)} onClick={()=>{onEdit({kind:'members',members,coordinatorIdentity:coordinator});setOpen(false);}}>Save membership</button><button onClick={()=>void refresh()}>Refresh sessions</button><button onClick={()=>setOpen(false)}>Cancel</button></div>}
 </section>;
}
