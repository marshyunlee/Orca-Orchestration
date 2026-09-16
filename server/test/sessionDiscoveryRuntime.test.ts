import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {discoverGroupSessions} from '../src/sessionDiscovery.js';
test('exact caller discovery verifies its terminal without depending on other host inventories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'session-discovery-'));const prior=process.env.ORCA_WORK_CONTEXT_HELPER;
 const helper=join(root,'helper.py');
 await writeFile(helper,`def read_orca_result(args):
 if args[:2] != ['terminal','show']: raise ValueError('Unrelated remote inventory unavailable')
 return {'terminal': {'handle':'own','tabId':'tab','title':'Master','worktreePath':'/feature','agentIdentity':'codex','connected':True,'writable':True,'incarnationId':'inc','executionHostId':'local'}}
def read_bound_session(row):
 return {'session_id':'session'}
`);
 process.env.ORCA_WORK_CONTEXT_HELPER=helper;
 try{const found=await discoverGroupSessions({handle:'own'});assert.equal(found.members[0].identity,'codex:session');assert.equal(found.members[0].terminalHandle,'own');}
 finally{if(prior===undefined)delete process.env.ORCA_WORK_CONTEXT_HELPER;else process.env.ORCA_WORK_CONTEXT_HELPER=prior;await rm(root,{recursive:true,force:true});}
});
