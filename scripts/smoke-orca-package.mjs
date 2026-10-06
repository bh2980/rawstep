/** Installed Node transport/asset checks, explicitly not a live Orca validation. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { OrcaBackend, orcaBridgePath } from 'rawstep/orca';
const bridge=orcaBridgePath();assert.ok(bridge.startsWith(process.cwd()+'/node_modules/rawstep/native/'));assert.ok(existsSync(bridge));
const fixture=String.raw`
const readline=require('node:readline');let session;
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);const reply=result=>send({type:'response',id:r.id,result});
 if(r.method==='session.start'){session=r.params.sessionId;reply({protocol:'rawstep-orca-native-v1',sessionId:session,atName:'Orca',atVersion:'packaging-protocol-fixture',platformName:'linux',speechSource:'orca-speech',captureStage:'speech-dispatcher-submission',audioVerified:false,targetWindowId:12345,targetClass:'PackagingFixture',targetProcessId:123});}
 else if(r.method==='input.pressKeys'){reply({});setTimeout(()=>send({type:'speech',source:'orca-speech',sessionId:session,text:'Installed transport fixture output'}),10);}
 else if(r.method==='session.stop'){reply({});process.exit(0);}
});`;
const backend=new OrcaBackend({bridgeCommand:[process.execPath,'-e',fixture],targetWindowId:12345,quietMs:25,maxWaitMs:200});
try{assert.equal((await backend.start()).environment.atVersion,'packaging-protocol-fixture');await backend.execute({kind:'key',key:'Tab'});assert.deepEqual((await backend.observe()).speech,['Installed transport fixture output']);}finally{await backend.close()}
let pythonGuard='not-applicable';
if(process.platform==='linux'&&existsSync('/usr/bin/python3')){
 const unavailable=new OrcaBackend({bridgeCommand:['/usr/bin/env','DISPLAY=','DBUS_SESSION_BUS_ADDRESS=','/usr/bin/python3',bridge]});
 try{await assert.rejects(unavailable.start(),/real X11 DISPLAY/);await assert.rejects(unavailable.execute({kind:'key',key:'Tab'}));pythonGuard='passed';}finally{await unavailable.close()}
}
console.log(JSON.stringify({assetResolution:'passed',subprocessProtocolFixture:'passed',pythonMissingDisplayGuard:pythonGuard,nativeOrcaSpeechValidated:false}));
