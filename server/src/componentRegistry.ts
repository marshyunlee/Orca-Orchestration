import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { validateStorageId } from './boardStore.js';
export interface ComponentAssociation {
  boardId:string;nodeId:string;runId:string;masterIdentity:string;terminalHandle:string;manifestPath:string;url:string;
}
export async function registerComponentRun(association:ComponentAssociation,canReplace?:(previous:ComponentAssociation)=>boolean):Promise<void>{
  validateStorageId(association.runId);
  const root=join(process.env.ORCA_BOARD_RUNTIME??join(homedir(),'.local/state/orca-board'),'component-runs');
  await mkdir(root,{recursive:true,mode:0o700});
  const path=join(root,`${association.runId}.json`),value=JSON.stringify(association);
  try { await writeFile(path,value,{flag:'wx',mode:0o600}); }
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const previous=JSON.parse(await readFile(path,'utf8')) as ComponentAssociation;
    if(JSON.stringify(previous)!==value){
      if(!canReplace?.(previous))throw new Error('Component Run already belongs to a different board binding; reconcile its ownership before changing it');
      const temporary=`${path}.${randomUUID()}.tmp`;
      await writeFile(temporary,value,{flag:'wx',mode:0o600});await rename(temporary,path);
    }
  }
}
