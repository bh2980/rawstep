import { describe, expect, it } from 'vitest';
import { resolveTask, validateNavigation, type VerifyRule } from '@rawstep/core/contracts';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const task = { url: 'https://example.test/app', goal: 'Finish', verify: { all: [{ titleIncludes: 'Done' }] } };
describe('retained task, action and configuration contracts', () => {
  it('accepts every retained independent verifier rule', () => {
    const all: VerifyRule[] = [{ titleIncludes:'Done' }, {urlIncludes:'/done'}, {textVisible:'Done'}, {textVisibleExact:'Done'}, {activatedAnnouncementIncludes:'Done'}, {domEventSeen:{selector:'button',event:'click'}}, {requestSeen:{urlIncludes:'/api',method:'POST'}}, {responseSeen:{urlIncludes:'/api',method:'POST',status:201}}];
    expect(resolveTask({...task,verify:{all}}).verify).toEqual({all});
  });
  it.each([
    {}, { all: [] }, { all: [{ titleIncludes:'Done', textVisible:'Done' }] }, { all: [{unknown:'x'}] },
    { all: [{titleIncludes:' '}] }, {all:[{requestSeen:{urlIncludes:'/api',foo:'unexpected'}}]}, {all:[{domEventSeen:{selector:'button',event:'click',foo:true}}]}, {all:[{requestSeen:{urlIncludes:'/api',method:123}}]},
    {all:[{responseSeen:{urlIncludes:'',status:200}}]}, {all:[{responseSeen:{urlIncludes:'/api',status:'bad'}}]},
    {all:[{responseSeen:{urlIncludes:'/api',status:99}}]}, {all:[{responseSeen:{urlIncludes:'/api',status:600}}]},
    {all:[{domEventSeen:{selector:'',event:'click'}}]}, {all:[{domEventSeen:{selector:'button',event:2}}]},
  ])('rejects malformed verifier specifications %#', (verify) => {
    expect(() => resolveTask({...task,verify})).toThrow();
  });
  it.each([null, [], 'bad', {email:3}])('rejects malformed named inputs %#', input => {
    expect(() => resolveTask({...task,input})).toThrow(/input/i);
  });
  it('preserves named inputs without mutating the caller object', () => {
    const input = {email:'person@example.test', password:'only-a-test'};
    const result=resolveTask({...task,input});
    expect(result.input).toEqual(input); result.input!.email='changed'; expect(input.email).toBe('person@example.test');
  });
  it.each([0,-1,1.5,Number.NaN,Infinity,'5'])('rejects unsafe step budgets %#', maxSteps => {
    expect(() => resolveTask({...task,maxSteps})).toThrow(/maxSteps/);
  });
  it.each([0,-1,1.5,2_147_483_648,Infinity,'10'])('rejects unsafe time budgets %#', timeoutMs => {
    expect(() => resolveTask({...task,timeoutMs})).toThrow(/timeoutMs/);
  });
  it.each(['javascript:alert(1)','data:text/html,hello','ftp://example.test','ws://example.test'])('rejects unsafe task URL %s', url => {
    expect(() => resolveTask({...task,url})).toThrow(/URL/);
  });
  it('resolves relative fixture URLs against their task directory', () => {
    expect(resolveTask({...task,url:'../../fixtures/simple-cta.html'},resolve('examples/tasks')).url).toBe(pathToFileURL(resolve('fixtures/simple-cta.html')).href);
  });
  it.each(['simple-cta','bad-focus','email-login','login','search'])('keeps the original %s task fixture readable under the new contract', async name => {
    const source=JSON.parse(await readFile(resolve('examples/tasks',`${name}.json`),'utf8'));
    const resolved=resolveTask(source,resolve('examples/tasks'));
    expect(resolved.url).toMatch(/\/fixtures\/[^/]+\.html$/);expect(resolved.verify.all.length).toBeGreaterThan(0);
  });
  it.each([{}, {strategy:'same-origin'}, {strategy:'start-url-prefix'}, {strategy:'allow-url-list',allowUrlList:['https://example.test/safe']}])('accepts explicit navigation policies %#', config => {
    expect(validateNavigation(config).strategy).toBe(config.strategy??'same-origin');
  });
  it.each([{strategy:'unknown'}, {strategy:'same-origin',allowUrlList:['https://example.test']},{strategy:'allow-url-list',allowUrlList:[]},{strategy:'allow-url-list',allowUrlList:['javascript:alert(1)']},{strategy:'allow-url-list',allowUrlList:[22]}])('rejects malformed navigation policies %#', config => {
    expect(()=>validateNavigation(config)).toThrow();
  });
  it('does not mutate stored scripted decisions and ends deterministically on exhaustion', () => {
    const decisions=[{action:{kind:'key' as const,key:'Tab'}}]; const script=new ScriptedPolicy(decisions);
    const result=script.decide(); if('action' in result&&result.action.kind==='key')result.action.key='Enter';
    expect(decisions[0].action.key).toBe('Tab');expect(script.decide()).toMatchObject({stop:'stuck'});
  });
});
