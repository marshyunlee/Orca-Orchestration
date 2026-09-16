import {open,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import type {MemberRef} from '../../shared/board.js';
export interface SavedSessionContext {available:boolean;capturedAt:string|null;references:string[];text:string;error:string|null}
export async function readSavedSessionContext(member:MemberRef,vaultRoot=process.env.ORCA_WORK_VAULT??join(homedir(),'work-vault')):Promise<SavedSessionContext>{
 if(!/^[a-z0-9-]+$/i.test(member.sessionId) || !['codex','claude','cursor'].includes(member.source))throw new Error('Invalid saved session identity');
 const source=`sources/agent_sessions/${member.source}/${member.sessionId}.md`;
 const result:SavedSessionContext={available:false,capturedAt:null,references:[],text:'',error:null};
 async function readBounded(path:string,limit:number):Promise<string>{
  const root=await realpath(vaultRoot),filePath=await realpath(resolve(root,path));
  const relativePath=relative(root,filePath);if(relativePath.startsWith('..') || isAbsolute(relativePath))throw new Error('Context link escapes vault');
  const file=await open(filePath,'r');
  try{const stat=await file.stat();const size=Math.min(stat.size,limit),buffer=Buffer.alloc(size);const head=Math.ceil(size/2);await file.read(buffer,0,head,0);await file.read(buffer,head,size-head,Math.max(head,stat.size-(size-head)));return buffer.toString('utf8');}finally{await file.close();}
 }
 try{
  const text=await readBounded(source,16000);result.available=true;result.references.push(source);result.text=text;
  result.capturedAt=text.match(/(?:updated|created):\s*["']?([^\s"']+)/)?.[1]??null;
  const links=[...text.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map(match=>match[1].endsWith('.md')?match[1]:`${match[1]}.md`);
  for(const link of [...new Set(links)].filter(link=>/^(sessions|projects|00-Inbox)\//.test(link)).slice(0,3)){
   try{const content=await readBounded(link,2400);result.references.push(link);result.text+=`\n\nSource: ${link}\n${content}`;}catch{/* Missing canonical links do not prevent fresh collection. */}
  }
  result.text=result.text.slice(0,24000);
 }catch(error){result.error=(error as NodeJS.ErrnoException).code==='ENOENT'?'No saved context':String(error);}
 return result;
}
