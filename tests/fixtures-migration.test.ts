import { afterEach, describe, expect, it } from 'vitest';
import { domFixture } from './helpers/dom-fixture.js';
import { evaluateVerifyRule, formatVerificationFeedback, verifyTask } from '@rawstep/browser/verify';
import type { Task, Observation } from '@rawstep/core/contracts';

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanup.splice(0))close();});
async function fixture(name:string){const f=await domFixture(name);cleanup.push(()=>f.dom.window.close());return f;}
const window={id:'actual-activation-window',startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),reason:'quiet'};

describe('historical fixture behavior, executed as DOM tests rather than native browser tests',()=>{
  it('verifies simple CTA title, URL, visible partial and exact success text after actual fixture activation',async()=>{
    const f=await fixture('simple-cta.html');
    expect(await evaluateVerifyRule({textVisible:'Started!'},f.session)).toMatch(/not observed/);
    f.element<HTMLButtonElement>('#start').click();
    for(const rule of [{titleIncludes:'Completed'},{urlIncludes:'simple-cta.html'},{textVisible:'Started'},{textVisibleExact:'Started!'}])expect(await evaluateVerifyRule(rule,f.session)).toBeUndefined();
    expect(await evaluateVerifyRule({textVisibleExact:'Started'},f.session)).toMatch(/not observed/);
  });
  it('keeps natural page focus and root tabindex untouched on initial fixture load',async()=>{
    const f=await fixture('simple-cta.html');expect(f.document.activeElement).toBe(f.document.body);
    expect(f.document.documentElement.hasAttribute('tabindex')).toBe(false);expect(f.document.body.hasAttribute('tabindex')).toBe(false);
  });
  it('does not confuse bad-focus noise controls with completion, then verifies the real target',async()=>{
    const f=await fixture('bad-focus.html');const rule={textVisibleExact:'Purchased!'};
    f.element('div[tabindex]').focus();expect(await evaluateVerifyRule(rule,f.session)).toMatch(/not observed/);
    f.element<HTMLButtonElement>('#buy-now').click();expect(await evaluateVerifyRule(rule,f.session)).toBeUndefined();expect(await evaluateVerifyRule({titleIncludes:'Completed - Bad Focus Fixture'},f.session)).toBeUndefined();
  });
  it('runs the search fixture script and requires selecting Passport2 rather than any result',async()=>{
    const f=await fixture('search.html');f.fill('#query','passport');f.submit('#search-form');
    f.element<HTMLButtonElement>('button[aria-label="Open Passport1"]').click();expect(await evaluateVerifyRule({titleIncludes:'Completed'},f.session)).toMatch(/failed/);
    f.element<HTMLButtonElement>('button[aria-label="Open Passport2"]').click();
    expect(await evaluateVerifyRule({titleIncludes:'Completed - Search'},f.session)).toBeUndefined();expect(await evaluateVerifyRule({textVisibleExact:'Selected Passport2'},f.session)).toBeUndefined();
  });
  it('rejects an empty search query and restores focus without showing results',async()=>{
    const f=await fixture('search.html');f.submit('#search-form');
    expect(f.element('#results').hidden).toBe(true);expect(f.document.activeElement).toBe(f.element('#query'));
    expect(await evaluateVerifyRule({textVisible:'Enter a search query.'},f.session)).toBeUndefined();
  });
  it.each([
    ['', 'Enter your email address before requesting a magic link.'],
    ['not-an-email','Enter a valid email address like name@example.com.'],
  ])('preserves email validation for %j and hides success',async(value,message)=>{
    const f=await fixture('email-login.html');f.fill('#email',value);f.submit('#login-form');
    expect(f.document.title).toBe('Hello');expect(f.element('#status').hidden).toBe(true);expect(f.element('#email-error').textContent).toContain(message);expect(f.element('#email').getAttribute('aria-invalid')).toBe('true');
    expect(await evaluateVerifyRule({textVisible:'Magic link sent.'},f.session)).toMatch(/not observed/);
  });
  it('completes email login with its named example input and independently visible success',async()=>{
    const f=await fixture('email-login.html');f.fill('#email','traveler@example.com');f.submit('#login-form');
    expect(await evaluateVerifyRule({titleIncludes:'Completed - Email Login Fixture'},f.session)).toBeUndefined();expect(await evaluateVerifyRule({textVisibleExact:'Magic link sent. traveler@example.com'},f.session)).toBeUndefined();
  });
  it('preserves empty credential validation for both fields',async()=>{
    const f=await fixture('credential-login.html');f.submit('#credential-form');
    expect(f.document.title).toBe('Credential Login Fixture');expect(f.element('#status').hidden).toBe(true);
    expect(f.element('#credential-email-error').textContent).toContain('Enter your email address before signing in.');expect(f.element('#credential-password-error').textContent).toContain('Enter your password before signing in.');
    expect(f.element('#email').getAttribute('aria-invalid')).toBe('true');expect(f.element('#password').getAttribute('aria-invalid')).toBe('true');
  });
  it('preserves malformed credential email validation without inventing a password error',async()=>{
    const f=await fixture('credential-login.html');f.fill('#email','not-an-email');f.fill('#password','test-secret');f.submit('#credential-form');
    expect(f.element('#status').hidden).toBe(true);expect(f.element('#credential-email-error').textContent).toContain('Enter a valid email address like name@example.com.');expect(f.element('#credential-password-error').hidden).toBe(true);
  });
  it('completes the credential fixture with both named inputs',async()=>{
    const f=await fixture('credential-login.html');f.fill('#email','traveler@example.com');f.fill('#password','test-secret');f.submit('#credential-form');
    expect(await evaluateVerifyRule({titleIncludes:'Credential Login Completed'},f.session)).toBeUndefined();expect(await evaluateVerifyRule({textVisibleExact:'Signed in.'},f.session)).toBeUndefined();
  });
  it('checks request and response URL/method/status independently of page success',async()=>{
    const f=await fixture('simple-cta.html');f.session.network.requests.push({url:'https://example.test/api/cart',method:'POST',timestamp:new Date().toISOString()});f.session.network.responses.push({url:'https://example.test/api/cart',method:'POST',status:201,ok:true,timestamp:new Date().toISOString()});
    expect(await evaluateVerifyRule({requestSeen:{urlIncludes:'/api/cart',method:'post'}},f.session)).toBeUndefined();expect(await evaluateVerifyRule({responseSeen:{urlIncludes:'/api/cart',method:'POST',status:201}},f.session)).toBeUndefined();
    expect(await evaluateVerifyRule({requestSeen:{urlIncludes:'/api/cart',method:'GET'}},f.session)).toMatch(/failed/);expect(await evaluateVerifyRule({responseSeen:{urlIncludes:'/api/cart',status:200}},f.session)).toMatch(/failed/);
  });
  it('requires collected activation-window speech and never substitutes visible DOM text',async()=>{
    const f=await fixture('simple-cta.html');f.element<HTMLButtonElement>('#start').click();const rule={activatedAnnouncementIncludes:'Started!'};
    expect(await evaluateVerifyRule(rule,f.session)).toMatch(/no screenreader/);
    const observation:Observation={kind:'screenreader',speech:['Started!'],outputEventIds:['output-1'],window};
    expect(await evaluateVerifyRule(rule,f.session,{latestActivation:{step:1,action:{kind:'intent',intent:'activate'},observation}})).toBeUndefined();
  });
  it('combines verifier failures without accepting a partially passed task',async()=>{
    const f=await fixture('simple-cta.html');const task:Task={url:f.session.page.url(),goal:'Start',verify:{all:[{titleIncludes:'Simple CTA'},{textVisible:'Started!'}]}};
    const result=await verifyTask(task,f.session);expect(result.passed).toBe(false);expect(result.failures).toHaveLength(1);expect(formatVerificationFeedback(result)).toBe(result.failures[0]);
  });
  it('does not accept hidden exact matches and can find a visible match after hidden duplicates',async()=>{
    const f=await fixture('simple-cta.html');f.document.body.insertAdjacentHTML('beforeend','<p hidden>Duplicate</p><p>Duplicate</p><p style="display:none">Hidden marker</p>');
    expect(await evaluateVerifyRule({textVisibleExact:'Duplicate'},f.session)).toBeUndefined();expect(await evaluateVerifyRule({textVisibleExact:'Hidden marker'},f.session)).toMatch(/not observed/);
  });
});
