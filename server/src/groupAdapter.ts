import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemberRef } from "../../shared/board.js";
const execute=promisify(execFile);
export interface GroupReceipt { id:string;status:string;revision:number;document:string;members:unknown[];assignments:Record<string,unknown>;[key:string]:unknown }
export function groupMemberPayload(member:MemberRef) {return {identity:member.identity,domain:member.tabName||member.source,handle:member.terminalHandle,incarnation:member.incarnationId,host:member.hostId};}
export async function callGroupHelper(args:string[]):Promise<GroupReceipt>{
  if(!process.env.ORCA_GROUP_HELPER)throw new Error("Group integration unavailable: configure ORCA_GROUP_HELPER");
  const helper=await realpath(process.env.ORCA_GROUP_HELPER);
  const result=await execute(process.env.ORCA_BOARD_PYTHON??"python3",[helper,"--orca",process.env.ORCA_CLI_COMMAND??"orca",...args],{timeout:60000,maxBuffer:8*1024*1024});
  return JSON.parse(result.stdout);
}
export async function updateGroupMembers(groupId:string,actor:string,members:MemberRef[]):Promise<GroupReceipt>{
  const directory=await mkdtemp(join(tmpdir(),"orca-board-members-"));
  try {
    const path=join(directory,"members.json");
    await writeFile(path,JSON.stringify(members.map(groupMemberPayload)),{mode:0o600});
    return await callGroupHelper(["update-members","--group",groupId,"--actor",actor,"--members-file",path]);
  }finally{await rm(directory,{recursive:true,force:true});}
}
