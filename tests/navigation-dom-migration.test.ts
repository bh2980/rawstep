import { JSDOM, VirtualConsole } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({launch:vi.fn()}));
vi.mock('playwright',()=>({chromium:{launch:mocks.launch}}));
import { createBrowserSession, type BrowserSession } from '@rawstep/browser/browser';
import { evaluateVerifyRule } from '@rawstep/browser/verify';
import type { NavigationPolicy } from '@rawstep/core/contracts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
beforeEach(()=>mocks.launch.mockReset());

/** Real document guard/recorder scripts, with the browser/transport boundary mocked.
 * jsdom cannot establish network, layout, or native keyboard correctness. */
async function guardedDocument(navigation?:NavigationPolicy, html='') {
  const scripts:string[]=[];const bindings=new Map<string,(_source:unknown,payload:unknown)=>Promise<void>>();
  const virtualConsole=new VirtualConsole();
  const create=(url:string)=>{
    const result=new JSDOM(html||'<main><a id="link" href="/app/next">Next</a><form id="form" action="/app/done"><button id="submit">Submit</button></form><button id="target"><span id="child">Activate</span></button></main>',{url,runScripts:'outside-only',virtualConsole});
    for(const [name,binding]of bindings)(result.window as unknown as Record<string,unknown>)[name]=(payload:unknown)=>binding({},payload);
    for(const script of scripts)result.window.eval(script);
    return result;
  };
  let dom=create('about:blank');
  const page={
    on:vi.fn(),url:()=>dom.window.location.href,
    exposeBinding:vi.fn(async(name:string,fn:(_source:unknown,payload:unknown)=>Promise<void>)=>{bindings.set(name,fn);(dom.window as unknown as Record<string,unknown>)[name]=(payload:unknown)=>fn({},payload);}),
    addInitScript:vi.fn(async({content}:{content:string})=>{scripts.push(content);}),
    evaluate:vi.fn(async(script:string)=>dom.window.eval(script)),
    goto:vi.fn(async(url:string)=>{dom.window.close();dom=create(url);}),
    waitForLoadState:vi.fn(async()=>{}),mainFrame:()=>({}),
  };
  const cdp={on:vi.fn(),send:vi.fn(async(method:string)=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'main'}}}:{})};
  const context={newPage:vi.fn(async()=>page),newCDPSession:vi.fn(async()=>cdp),route:vi.fn(async()=>{}),on:vi.fn(),close:vi.fn(async()=>dom.window.close())};
  const browser={newContext:vi.fn(async()=>context),close:vi.fn(async()=>{})};mocks.launch.mockResolvedValue(browser);
  const session=await createBrowserSession('https://safe.example/app/',{navigation,verify:{all:[{domEventSeen:{selector:'#target',event:'click'}},{domEventSeen:{selector:'#target',event:'click'}}]}});
  cleanup.push(()=>session.close());
  const node=<T extends HTMLElement=HTMLElement>(selector:string)=>dom.window.document.querySelector(selector) as T;
  const click=(selector:string)=>{const event=new dom.window.MouseEvent('click',{bubbles:true,cancelable:true});node(selector).dispatchEvent(event);return event;};
  const key=(selector:string)=>{node(selector).focus();const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});node(selector).dispatchEvent(event);return event;};
  const submit=()=>{const event=new dom.window.Event('submit',{bubbles:true,cancelable:true});node('#form').dispatchEvent(event);return event;};
  return {get dom(){return dom;},session,node,click,key,submit,context,scripts};
}

describe('ported document navigation guards and event recording',()=>{
  it('blocks cross-origin anchor clicks and keeps target/reason diagnostics',async()=>{
    const f=await guardedDocument();f.node<HTMLAnchorElement>('#link').href='https://outside.example/';expect(f.click('#link').defaultPrevented).toBe(true);
    expect(f.session.takeBlockedNavigations()).toEqual([expect.objectContaining({url:'https://outside.example/',reason:expect.stringContaining('same-origin')})]);
    expect(f.session.takeBlockedNavigations()).toEqual([]);
  });
  it.each(['/next','/next?q=1','#section'])('permits same-origin path/query/hash %s',async target=>{
    const f=await guardedDocument();f.node<HTMLAnchorElement>('#link').href=target;expect(f.click('#link').defaultPrevented).toBe(false);expect(f.session.takeBlockedNavigations()).toEqual([]);
  });
  it('blocks a start-prefix escape and allows a child target',async()=>{
    const f=await guardedDocument({strategy:'start-url-prefix'});f.node<HTMLAnchorElement>('#link').href='/outside';expect(f.click('#link').defaultPrevented).toBe(true);
    f.node<HTMLAnchorElement>('#link').href='/app/next';expect(f.click('#link').defaultPrevented).toBe(false);
  });
  it('normalizes relative links before enforcing the allow list',async()=>{
    const f=await guardedDocument({strategy:'allow-url-list',allowUrlList:['https://safe.example/app/allowed']});
    f.node<HTMLAnchorElement>('#link').href='./blocked';expect(f.click('#link').defaultPrevented).toBe(true);expect(f.session.takeBlockedNavigations()[0].url).toBe('https://safe.example/app/blocked');
    f.node<HTMLAnchorElement>('#link').href='./allowed';expect(f.click('#link').defaultPrevented).toBe(false);
  });
  it('blocks deceptively similar hostnames for an allow-list prefix',async()=>{
    const f=await guardedDocument({strategy:'allow-url-list',allowUrlList:['https://safe.example']});f.node<HTMLAnchorElement>('#link').href='https://safe.example.attacker.test/app';expect(f.click('#link').defaultPrevented).toBe(true);
  });
  it('blocks new-tab anchors even when the destination has the same origin',async()=>{
    const f=await guardedDocument();f.node<HTMLAnchorElement>('#link').target='_blank';expect(f.click('#link').defaultPrevented).toBe(true);expect(f.session.takeBlockedNavigations()[0].reason).toMatch(/Popup|new.tab/i);
  });
  it('blocks window.open before a popup is created',async()=>{
    const f=await guardedDocument();expect(f.dom.window.open('/app/next')).toBeNull();expect(f.session.takeBlockedNavigations()[0].url).toBe('https://safe.example/app/next');
  });
  it('blocks Enter activation on disallowed anchors',async()=>{
    const f=await guardedDocument();f.node<HTMLAnchorElement>('#link').href='https://outside.example/';expect(f.key('#link').defaultPrevented).toBe(true);
  });
  it('blocks disallowed form submissions',async()=>{
    const f=await guardedDocument();f.node<HTMLFormElement>('#form').action='https://outside.example/post';expect(f.submit().defaultPrevented).toBe(true);expect(f.session.takeBlockedNavigations()[0].url).toBe('https://outside.example/post');
  });
  it('blocks same-origin popup form submissions',async()=>{
    const f=await guardedDocument();f.node<HTMLFormElement>('#form').target='_blank';expect(f.submit().defaultPrevented).toBe(true);
  });
  it('normalizes relative form actions before applying the allow list',async()=>{
    const f=await guardedDocument({strategy:'allow-url-list',allowUrlList:['https://safe.example/app/allowed']});f.node<HTMLFormElement>('#form').action='./blocked';expect(f.submit().defaultPrevented).toBe(true);
    expect(f.session.takeBlockedNavigations()[0].url).toBe('https://safe.example/app/blocked');f.node<HTMLFormElement>('#form').action='./allowed';expect(f.submit().defaultPrevented).toBe(false);
  });
  it('blocks Enter on a submit control for a disallowed form',async()=>{
    const f=await guardedDocument();f.node<HTMLFormElement>('#form').action='https://outside.example/post';expect(f.key('#submit').defaultPrevented).toBe(true);
  });
  it('blocks programmatic anchor clicks and requestSubmit calls',async()=>{
    const f=await guardedDocument();f.node<HTMLAnchorElement>('#link').href='https://outside.example/link';f.node<HTMLAnchorElement>('#link').click();
    f.node<HTMLFormElement>('#form').action='https://outside.example/form';f.node<HTMLFormElement>('#form').requestSubmit();expect(f.session.takeBlockedNavigations().map(x=>x.url)).toEqual(['https://outside.example/link','https://outside.example/form']);
  });
  it('uses real delegated event recording once per selector and supports descendant targets',async()=>{
    const f=await guardedDocument();expect(await evaluateVerifyRule({domEventSeen:{selector:'#target',event:'click'}},f.session)).toMatch(/not observed/);
    f.click('#child');await Promise.resolve();expect(f.session.domEvents).toHaveLength(1);expect(await evaluateVerifyRule({domEventSeen:{selector:'#target',event:'click'}},f.session)).toBeUndefined();
  });
  it('disables service workers before creating the page and installs guards without focus mutation',async()=>{
    const f=await guardedDocument();expect(mocks.launch.mock.results.length).toBe(1);const browser=await mocks.launch.mock.results[0].value;
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({serviceWorkers:'block'}));
    expect(f.dom.window.document.activeElement).toBe(f.dom.window.document.body);expect(f.dom.window.document.documentElement.hasAttribute('tabindex')).toBe(false);
  });
});
