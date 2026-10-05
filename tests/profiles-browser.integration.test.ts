import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createTestBrowserSession } from './helpers/browser.js';
import { collectBrowserDiagnostics, resolveEnvironmentProfile, verifyLiveProfile } from '@rawstep/browser/profiles';
import { runScreenshotTask, ScreenshotDecisionPolicy } from 'rawstep/screenshot';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { runEnvironmentMatrix, readMatrix } from '@rawstep/cli/matrix';
import { runTask } from '@rawstep/browser/runner';
import type { CreateBrowserSessionOptions } from '@rawstep/browser/browser';
import type { Backend, Decision } from '@rawstep/core/contracts';
const cleanups:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn()});
const fixture=pathToFileURL(resolve('fixtures/environment-lab.html')).href;
async function dir(){const p=await mkdtemp(join(tmpdir(),'rawstep-profiles-'));cleanups.push(()=>rm(p,{recursive:true,force:true}));return p}
const key=(key:string):Decision=>({action:{kind:'key',key}});

describe('actual browser environment profiles and isolated diagnostics',()=>{
  it.each(['default','narrow','text-200','spacing','forced-colors','contrast','dark','reduced-motion','reflow-text'])('applies and independently verifies %s',async name=>{
    const session=await createTestBrowserSession(fixture,{profile:resolveEnvironmentProfile(name)});cleanups.push(()=>session.close());expect(session.appliedProfile?.supported).toBe(true);
    expect((await verifyLiveProfile(session.page,resolveEnvironmentProfile(name))).every(s=>s.status==='applied')).toBe(true);
    const d=await collectBrowserDiagnostics(session.page);expect(d.policyVisible).toBe(false);if(['narrow','reflow-text'].includes(name))expect(d.findings.some(f=>f.code==='horizontal-overflow')).toBe(true);
    if(name==='text-200')expect(await session.page.locator('body').evaluate(e=>getComputedStyle(e).fontSize)).toBe('40px');
    if(name==='reduced-motion')expect(await session.page.locator('.ticker').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
  });
  it('rejects unsupported true browser zoom before any policy/model call and saves precise setting evidence',async()=>{
    let calls=0;const trace=await runScreenshotTask({id:'zoom',url:fixture,goal:'Inspect',verify:{all:[{titleIncludes:'Never'}]}},{profile:'zoom-200',outDir:await dir(),browserSessionFactory:createTestBrowserSession,policy:{decide:()=>{calls++;return {stop:'stuck'}}}});
    expect(calls).toBe(0);expect(trace.outcome).toMatchObject({status:'inconclusive',reason:'unsupported-profile'});expect(trace.events.find(e=>e.type==='browser.profile')?.data).toMatchObject({supported:false,settings:expect.arrayContaining([expect.objectContaining({name:'browserZoom',status:'unsupported',mechanism:'browser-native'})])});
  });
  it('never treats CDP pinch as genuine browser zoom',async()=>{
    const trace=await runScreenshotTask({url:fixture,goal:'Inspect',verify:{all:[{titleIncludes:'Never'}]}},{profile:'zoom-200',outDir:await dir(),browserSessionFactory:createTestBrowserSession,nativeZoom:async page=>{const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});await cdp.detach();return {observedFactor:2,method:'invalid-pinch-test-double'}},policy:new ScriptedPolicy([])});
    expect(trace.outcome?.reason).toBe('unsupported-profile');
  });
  it('records skip-link focus sequence, modal escape/restoration and error recovery independently',async()=>{
    const s=await createTestBrowserSession(fixture,{profile:resolveEnvironmentProfile('default')});cleanups.push(()=>s.close());await s.page.keyboard.press('Tab');expect((await collectBrowserDiagnostics(s.page)).focus.tag).toBe('a');await s.page.keyboard.press('Enter');expect((await collectBrowserDiagnostics(s.page)).focus.id).toBe('#main');
    await s.page.keyboard.press('Tab');await s.page.keyboard.press('Enter');expect((await collectBrowserDiagnostics(s.page)).modal).toMatchObject({open:true,focusInside:true});await s.page.keyboard.press('Escape');expect((await collectBrowserDiagnostics(s.page)).focus.id).toBe('#open');
    await s.page.keyboard.press('Tab');await s.page.keyboard.press('Tab');await s.page.keyboard.press('Tab');await s.page.keyboard.press('Enter');const error=await collectBrowserDiagnostics(s.page);expect(error.errorState.invalidCount).toBe(1);expect(error.focus.id).toBe('#email');await s.page.keyboard.type('test@example.com');await s.page.keyboard.press('Tab');await s.page.keyboard.press('Enter');expect((await collectBrowserDiagnostics(s.page)).errorState.invalidCount).toBe(0);
  });
  it('detects hidden/occluded focus and clipping as uncertain diagnostics',async()=>{
    const d=await dir(),file=join(d,'case.html');await writeFile(file,'<!doctype html><button id="b" autofocus style="position:absolute;top:30px;outline:none">Hidden indicator</button><div style="position:fixed;inset:0;background:white;z-index:5"></div><p style="height:2px;overflow:hidden">Clipped text</p>');
    const s=await createTestBrowserSession(pathToFileURL(file).href);cleanups.push(()=>s.close());const report=await collectBrowserDiagnostics(s.page);expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({code:'focus-center-occluded',certainty:'suspected'}),expect.objectContaining({code:'text-clipping'})]));
  });
  it('keeps all independent diagnostics out of screenshot model input and redacts after text entry',async()=>{
    const choices=['key:Tab','key:Tab','key:Tab','key:Tab','type:email','stop:uncertain'];let n=0;const requests:unknown[]=[];const out=await dir();
    const trace=await runScreenshotTask({id:'privacy',url:fixture,goal:'Inspect',maxSteps:8,input:{email:'PRIVATE_PROFILE_INPUT'},verify:{all:[{titleIncludes:'Never'}]}},{profile:'default',outDir:out,browserSessionFactory:createTestBrowserSession,policy:new ScreenshotDecisionPolicy({maxStateVisits:20,maxUnchangedTransitions:20,model:{choose:async req=>{requests.push(req);return {choiceId:choices[n++]!,model:{id:'fixture-only',runtime:'test'}}}}})});
    expect(trace.events.filter(e=>e.type==='browser.accessibility-diagnostic').at(-1)?.redacted).toBe(true);expect(await readFile(join(out,'trace.json'),'utf8')).not.toContain('PRIVATE_PROFILE_INPUT');expect(JSON.stringify(requests)).not.toMatch(/independent-browser-diagnostic|focus-center-occluded|"profile"|"editable"/);expect(trace.outcome).toMatchObject({status:'inconclusive',reason:'policy-uncertain',policyStopSource:'model'});
  });
  it('verifies live text-style drift and stops rather than silently running the wrong profile',async()=>{
    const d=await dir(),file=join(d,'drift.html');await writeFile(file,'<!doctype html><button autofocus onclick="document.body.style.setProperty(\'font-size\',\'7px\',\'important\')">Change style</button>');
    const trace=await runScreenshotTask({url:pathToFileURL(file).href,goal:'Inspect',maxSteps:3,verify:{all:[{titleIncludes:'Never'}]}},{profile:'text-200',outDir:join(d,'run'),browserSessionFactory:createTestBrowserSession,policy:new ScriptedPolicy([key('Enter')])});expect(trace.outcome?.reason).toBe('unsupported-profile');
  });
  it('executes matching tasks with fresh policies and produces a comparison including unsupported rows',async()=>{
    let policies=0;const d=await dir();const report=await runEnvironmentMatrix({id:'matrix-task',url:fixture,goal:'Finish',maxSteps:5,verify:{all:[{textVisibleExact:'Task completed successfully'}]}},{outDir:join(d,'matrix'),profiles:['default','forced-colors','zoom-200'],mode:'screenshot',browserSessionFactory:createTestBrowserSession,createPolicy:()=>{policies++;return new ScriptedPolicy([key('Tab'),key('Tab'),key('Tab'),key('Enter')])},humanEvidence:[{id:'review',taskId:'matrix-task',profileId:'default',observedAt:'2026-10-01T00:00:00Z',sourceUrl:'https://example.com/test/1',consent:'confirmed',summary:'Synthetic importer test only',reviewer:'test fixture',result:'confirmed-defect'}]});
    expect(policies).toBe(3);expect(report.rows.map(r=>r.classification)).toEqual(['task-completed','task-completed','unsupported-environment']);expect(report.rows[0]!.findings.some(f=>f.category==='confirmed-defect'&&f.source==='human-evidence')).toBe(true);expect((await readMatrix(join(d,'matrix','matrix.json'))).id).toBe(report.id);expect(await readFile(join(d,'matrix','matrix.html'),'utf8')).toContain('Compared with first supported observed profile');
  });
  it('stops matrix scheduling on cancellation and preserves a valid manifest',async()=>{
    const controller=new AbortController();const d=await dir();const report=await runEnvironmentMatrix({id:'cancel',url:fixture,goal:'Inspect',verify:{all:[{titleIncludes:'Never'}]}},{outDir:join(d,'matrix'),profiles:['default','dark'],mode:'screenshot',signal:controller.signal,browserSessionFactory:createTestBrowserSession,createPolicy:()=>({decide:()=>{controller.abort('SIGINT');return {stop:'stuck'}}})});expect(report.status).toBe('aborted');expect(report.rows).toHaveLength(1);
  });
  it('lets a backend refuse the host before the browser opens and the opened session before observation or dispatch',async()=>{
    const make=(hooks:Partial<Backend>):Backend=>({capabilities:{intents:[],keys:[],textEntry:false,replaceText:false},start:async()=>({}),subscribe:()=>()=>{},close:async()=>{},execute:async()=>{throw Error('must not dispatch')},observe:async()=>{throw Error('must not observe')},...hooks});
    let opened=0,closed=0;const contexts:unknown[]=[];
    const browserSessionFactory=async(url:string,options:CreateBrowserSessionOptions)=>{opened++;const s=await createTestBrowserSession(url,options);const close=s.close;s.close=async()=>{closed++;await close()};return s};
    const host=await runTask({url:fixture,goal:'Inspect',verify:{all:[{titleIncludes:'Never'}]}},{backend:make({preflight:context=>{contexts.push(context);throw new Error('host refused')}}),policy:new ScriptedPolicy([]),outDir:await dir(),browserSessionFactory});
    expect(host.outcome?.error).toMatch(/host refused/);expect(opened).toBe(0);
    expect(contexts).toEqual([{headless:false,platform:process.platform,customBrowserSession:true}]);
    const session=await runTask({url:fixture,goal:'Inspect',verify:{all:[{titleIncludes:'Never'}]}},{backend:make({attachSession:()=>{throw new Error('session refused')}}),policy:new ScriptedPolicy([]),outDir:await dir(),browserSessionFactory});
    expect(session.outcome?.error).toMatch(/session refused/);expect(opened).toBe(1);expect(closed).toBe(1);
  });
});

describe('reviewed dynamic profile and focus identity cases',()=>{
 it('distinguishes two id-less controls and duplicate-id controls',async()=>{const d=await dir(),file=join(d,'ids.html');await writeFile(file,'<!doctype html><button>one</button><button>two</button><button id="same">three</button><button id="same">four</button>');const s=await createTestBrowserSession(pathToFileURL(file).href);cleanups.push(()=>s.close());const ids=[];for(let i=0;i<4;i++){await s.page.keyboard.press('Tab');ids.push((await collectBrowserDiagnostics(s.page)).focus.identity)}expect(new Set(ids).size).toBe(4)});
 it('does not treat a nonmodal dialog as an active modal',async()=>{const d=await dir(),file=join(d,'dialog.html');await writeFile(file,'<!doctype html><dialog open><button autofocus>nonmodal</button></dialog>');const s=await createTestBrowserSession(pathToFileURL(file).href);cleanups.push(()=>s.close());expect((await collectBrowserDiagnostics(s.page)).modal.open).toBe(false)});
 it('detects spacing override on a later paragraph and unprofiled dynamic text',async()=>{const s=await createTestBrowserSession(fixture,{profile:resolveEnvironmentProfile('spacing')});cleanups.push(()=>s.close());await s.page.locator('p').last().evaluate(e=>(e as HTMLElement).style.setProperty('letter-spacing','0px','important'));expect((await verifyLiveProfile(s.page,resolveEnvironmentProfile('spacing'))).find(x=>x.name==='textSpacing')?.status).toBe('mismatch');await s.page.evaluate(()=>document.body.appendChild(document.createElement('p')));expect((await verifyLiveProfile(s.page,resolveEnvironmentProfile('spacing'))).some(x=>x.status==='mismatch')).toBe(true)});
 it('settles cancellation even when a policy factory ignores its signal',async()=>{const controller=new AbortController(),d=await dir();setTimeout(()=>controller.abort('SIGTERM'),30);const result=await runEnvironmentMatrix({id:'factory-cancel',url:fixture,goal:'Never',timeoutMs:10000,verify:{all:[{titleIncludes:'Never'}]}},{outDir:join(d,'matrix'),profiles:['default'],mode:'screenshot',signal:controller.signal,createPolicy:async()=>new Promise(()=>{})});expect(result).toMatchObject({status:'aborted',cancellationSignal:'SIGTERM',rows:[]})});
});

describe('nonsecure-page diagnostics',()=>{
  it('keeps document and control identities stable on about:blank without page randomUUID',async()=>{
    const s=await createTestBrowserSession(fixture);cleanups.push(()=>s.close());
    const context=await s.browser.newContext();const page=await context.newPage();await page.setContent('<!doctype html><button>one</button><button>two</button>');
    expect(await page.evaluate(()=>isSecureContext)).toBe(false);
    expect(await page.evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');
    await page.locator('button').first().focus();const first=await collectBrowserDiagnostics(page),again=await collectBrowserDiagnostics(page);
    expect(first.documentId).toMatch(/^[0-9a-f-]{36}$/);expect(again.documentId).toBe(first.documentId);expect(again.focus.identity).toBe(first.focus.identity);
    await page.locator('button').last().focus();const second=await collectBrowserDiagnostics(page);expect(second.documentId).toBe(first.documentId);expect(second.focus.identity).not.toBe(first.focus.identity);
  });
});


describe('profile mismatch privacy after named text entry',()=>{
  it('omits encoded page measurements from error events and the final environment',async()=>{
    const d=await dir(),file=join(d,'tainted-profile.html'),secret='PRIVATE_PROFILE_INPUT';
    await writeFile(file,`<!doctype html><input autofocus oninput="window.__rawstepMeasureProfile=()=>({unprofiledNodes:0,samples:[{baseline:10,actual:btoa(this.value)}],spacing:null})">`);
    const outDir=join(d,'run');
    const trace=await runScreenshotTask({id:'tainted-profile',url:pathToFileURL(file).href,goal:'Inspect',input:{secret},verify:{all:[{titleIncludes:'Never'}]}},{profile:'text-200',outDir,browserSessionFactory:createTestBrowserSession,policy:new ScriptedPolicy([{action:{kind:'typeText',input:'secret'}}])});
    expect(trace.outcome).toMatchObject({status:'inconclusive',reason:'unsupported-profile'});
    expect(trace.environment.profile).toMatchObject({supported:false,details:'[REDACTED]'});
    expect(trace.events.filter(e=>e.type==='browser.profile').at(-1)).toMatchObject({redacted:true,data:{supported:false,details:'[REDACTED]'}});
    expect(trace.events.filter(e=>e.type==='environment.updated').at(-1)?.redacted).toBe(true);
    for(const path of ['trace.json','trace.jsonl']){
      const stored=await readFile(join(outDir,path),'utf8');
      expect(stored).not.toContain(secret);expect(stored).not.toContain(Buffer.from(secret).toString('base64'));
    }
  });
});


describe('matrix named-input privacy',()=>{
  it('redacts task/profile/human metadata, withholds secret source URLs and keeps safe artifact links',async()=>{
    const d=await dir(),secret='PRIVATE_MATRIX_INPUT',outDir=join(d,'matrix'),taskId='review-'+secret;
    const result=await runEnvironmentMatrix({id:taskId,url:fixture,goal:'Inspect',input:{secret},verify:{all:[{titleIncludes:'Never'}]}},{outDir,profiles:[{...resolveEnvironmentProfile('default'),id:secret}],mode:'screenshot',browserSessionFactory:createTestBrowserSession,createPolicy:()=>new ScriptedPolicy([{stop:'uncertain'}]),humanEvidence:[{id:'human-'+secret,taskId,profileId:secret,observedAt:'2026-10-01T12:00:00Z',sourceUrl:`https://${secret}.example.test/`,consent:'confirmed',summary:'Private '+secret,result:'confirmed-defect',reviewer:'Reviewer '+secret}]});
    expect(JSON.stringify(result)).not.toContain(secret);expect(result.rows[0]!.reportPath).toBe('profile-1/report.html');
    expect(result.humanEvidence[0]).toMatchObject({sourceUrlRedacted:true,consent:'confirmed',result:'confirmed-defect'});
    expect((await readMatrix(join(outDir,'matrix.json'))).taskId).toBe(result.taskId);
    for(const path of ['matrix.json','matrix.html','profile-1/trace.json','profile-1/report.html'])expect(await readFile(join(outDir,path),'utf8')).not.toContain(secret);
    expect(await readFile(join(outDir,'matrix.html'),'utf8')).not.toContain('href="https://redacted.invalid/"');
  });
  it('preserves explicit inclusion and structural result enums',async()=>{
    const d=await dir();
    const result=await runEnvironmentMatrix({id:'review-visible',url:fixture,goal:'Inspect',input:{secret:'visible',structural:'completed'},verify:{all:[{titleIncludes:'Never'}]}},{outDir:join(d,'matrix'),profiles:['default'],mode:'screenshot',includeSensitiveInputValues:true,browserSessionFactory:createTestBrowserSession,createPolicy:()=>new ScriptedPolicy([{stop:'uncertain'}])});
    expect(result.taskId).toBe('review-visible');expect(result.status).toBe('completed');
  });
});
