import {realpathSync} from "node:fs";
import {resolve} from "node:path";
export const applying=new Set<string>();
export function workspaceKey(path:string):string{try{return realpathSync(path);}catch{return resolve(path);}}
export function assertWorkspaceAvailable(path:string):void{if(applying.has(workspaceKey(path)))throw new Error("Workspace file application is in progress");}
