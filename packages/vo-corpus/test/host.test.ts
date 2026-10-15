import assert from 'node:assert/strict';
import test from 'node:test';
import {createConnection} from 'node:net';
import {assertResumeEnvironment,collectionBrowser,localMachine,requireFrontmost,serveDirectory,type MachineFacts} from '../src/host.js';

test('native collection resumes the captured browser and refuses a profile switch',()=>{
  assert.equal(collectionBrowser(),'safari');
  assert.equal(collectionBrowser('chrome'),'chrome');
  assert.equal(collectionBrowser(undefined,'chrome'),'chrome');
  assert.equal(collectionBrowser('chrome','chrome'),'chrome');
  assert.throws(()=>collectionBrowser('safari','chrome'),/different browser/);
  assert.throws(()=>collectionBrowser('firefox'),/safari or chrome/);
  assert.throws(()=>collectionBrowser(undefined,'unknown'),/safari or chrome/);
});

test('fixture shutdown completes even when a browser leaves an unrequested speculative socket',async()=>{
  const server=await serveDirectory('.',localMachine),url=new URL(server.origin),socket=createConnection({host:url.hostname,port:Number(url.port)});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    await new Promise<void>((done,fail)=>{socket.once('connect',done);socket.once('error',fail);});
    await Promise.race([server.close(),new Promise<never>((_,fail)=>{timer=setTimeout(()=>fail(new Error('Fixture shutdown hung on a speculative socket')),1000);})]);
  }finally{clearTimeout(timer);socket.destroy();await server.close();}
});


test('resume refuses protocol, browser version, locale and AT drift without comparing volatile private caches',()=>{
  const machine:MachineFacts={machine:'test',macos:'26',build:'fixed',browser:{name:'chrome',version:'155'},locale:'en_KR',languages:'en-US',voiceOverAppVersion:'10',keyboardNavigation:'2',voiceOverSettings:{'com.apple.VoiceOver4/default':'unknown','com.apple.VoiceOverUtility':'volatile cache'}};
  const original={machine,settings:'baseline',workflowStartProtocol:'v3',observationProtocol:'v2',atDriver:{capabilities:{atName:'VoiceOver',atVersion:'26'}}};
  assert.doesNotThrow(()=>assertResumeEnvironment(original,structuredClone(original)));
  assert.doesNotThrow(()=>assertResumeEnvironment(original,{...original,machine:{...machine,voiceOverSettings:{...machine.voiceOverSettings,'com.apple.VoiceOverUtility':'new volatile cache'}}}));
  for(const change of [{settings:'different'},{workflowStartProtocol:'v4'},{observationProtocol:undefined},{machine:{...machine,browser:{name:'chrome' as const,version:'156'}}},{machine:{...machine,locale:'ko_KR'}},{atDriver:{capabilities:{atName:'VoiceOver',atVersion:'27'}}}]){
    assert.throws(()=>assertResumeEnvironment(original,{...original,...change}),/Cannot resume/);
  }
  assert.throws(()=>assertResumeEnvironment({...original,observationProtocol:undefined},original),/not recorded/);
});


test('Chrome-owned crash recovery dialogs fail the guard even when Chrome is frontmost',async()=>{
  const machine={...localMachine,exec:async(_file:string,args:string[])=>args.join(' ').includes('Restore pages?')?'true':'Google Chrome'};
  await assert.rejects(requireFrontmost(machine,'chrome')('Tab'),/environment failure/);
  await assert.rejects(requireFrontmost({...machine,exec:async()=> 'Finder'},'chrome')('Tab'),/not Google Chrome/);
  await assert.doesNotReject(requireFrontmost({...machine,exec:async(_file:string,args:string[])=>args.join(' ').includes('Restore pages?')?'false':'Google Chrome'},'chrome')('Tab'));
});

test('an active system permission alert stops keys even if System Events still marks Chrome frontmost',async()=>{
 const machine={...localMachine,exec:async(_file:string,args:string[])=>args.includes('JavaScript')?'UserNotificationCenter':'Google Chrome'};
 await assert.rejects(requireFrontmost(machine,'chrome')('Tab'),/UserNotificationCenter/);
 await assert.rejects(requireFrontmost({...machine,exec:async()=>''},'safari')('Tab'),/unknown app/);
});
