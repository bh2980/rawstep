import { afterEach, describe, expect, it } from 'vitest';
import { createTestBrowserSession } from './helpers/browser.js';
import { createNavigationFixtureServers } from './helpers/navigation-fixtures.js';
import type { NavigationPolicy } from '@rawstep/core/contracts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(path:string,policy?:(base:string)=>NavigationPolicy){
  const servers=await createNavigationFixtureServers();cleanup.push(()=>servers.close());
  const session=await createTestBrowserSession(`${servers.baseUrl}${path}`,{navigation:policy?.(servers.baseUrl)});cleanup.push(()=>session.close());
  return {...servers,session,page:session.page};
}
describe('historical navigation fixture safety in real Chromium',()=>{
  it.each([
    ['/same-origin-guard-start','#external-link','#same-origin-link','Same Origin Target'],
    ['/popup-start','#popup-link','#popup-fallback-link','Same Origin Target'],
    ['/form-start','#form-blocked-button','#form-fallback-link','Same Origin Target'],
    ['/form-popup-start','#form-popup-button','#form-popup-fallback-link','Same Origin Target'],
  ])('blocks the forbidden action on %s, records evidence, and remains usable',async(path,blocked,allowed,title)=>{
    const f=await fixture(path);await f.page.locator(blocked).click();
    await expect.poll(()=>f.session.navigation.blocked.length).toBeGreaterThan(0);
    expect(f.page.url()).toBe(`${f.baseUrl}${path}`);expect(f.session.context.pages()).toHaveLength(1);
    await f.page.locator(allowed).click();await expect.poll(()=>f.page.title()).toBe(title);
  });
  it.each(['/assign-start','/replace-start'])('blocks script navigation on %s at the native request boundary',async(path)=>{
    const f=await fixture(path);await f.page.locator('button').click({noWaitAfter:true});
    await expect.poll(()=>f.session.navigation.blocked.length).toBeGreaterThan(0);
    expect(f.session.navigation.blocked.some(event=>event.url.startsWith(f.externalUrl))).toBe(true);
    expect(f.page.url()).toBe(`${f.baseUrl}${path}`);
    await f.page.locator('a').click();expect(await f.page.title()).toBe('Same Origin Target');
  });
  it.each(['/same-origin-allowed-start','/assign-allowed-start'])('allows native same-origin path/query/hash on %s',async(path)=>{
    const f=await fixture(path);await f.page.locator('a,button').click();
    await expect.poll(()=>f.page.title()).toBe('Same Origin Target');expect(f.page.url()).toContain('#done');expect(f.session.takeBlockedNavigations()).toEqual([]);
  });
  it('enforces start-url-prefix and continues to an allowed prefix child',async()=>{
    const f=await fixture('/prefix/start',()=>({strategy:'start-url-prefix'}));await f.page.locator('#prefix-blocked-link').click();expect(f.session.takeBlockedNavigations()).toHaveLength(1);
    await f.page.locator('#prefix-allowed-link').click();expect(await f.page.title()).toBe('Prefix Allowed');
  });
  it('enforces an explicit allow list while permitting a listed destination',async()=>{
    const f=await fixture('/allow-list-start',base=>({strategy:'allow-url-list',allowUrlList:[`${base}/allow-list-start`,`${base}/allow-listed/`]}));await f.page.locator('#allow-unlisted-link').click();expect(f.session.takeBlockedNavigations()).toHaveLength(1);
    await f.page.locator('#allow-listed-link').click();expect(await f.page.title()).toBe('Allow Listed');
  });
  it.each([
    ['/relative-allow-list/start','#relative-allow-list-blocked-link','#relative-allow-list-allowed-link','/relative-allow-list/allowed/','Relative Allow Listed'],
    ['/relative-form-allow-list/start','#relative-form-blocked-button','#relative-form-allowed-link','/relative-form-allow-list/allowed/','Relative Form Allow Listed'],
  ])('normalizes relative link/form targets on %s',async(path,blocked,allowed,prefix,title)=>{
    const f=await fixture(path,base=>({strategy:'allow-url-list',allowUrlList:[`${base}${path}`,`${base}${prefix}`]}));await f.page.locator(blocked).click();expect(f.session.takeBlockedNavigations()[0].url).toContain('/blocked');
    await f.page.locator(allowed).click();expect(await f.page.title()).toBe(title);
  });
  it('prevents service-worker forwarding from escaping the allow list',async()=>{
    const f=await fixture('/sw-allow-list-start',base=>({strategy:'allow-url-list',allowUrlList:[`${base}/sw-allow-list-start`,`${base}/sw-allow-list-allowed/`]}));
    await f.page.locator('#sw-blocked-link').waitFor({state:'visible'});expect(await f.page.locator('#sw-status').textContent()).toMatch(/blocked/i);
    await f.page.locator('#sw-blocked-link').click();expect(f.session.takeBlockedNavigations()).toHaveLength(1);
    await f.page.locator('#sw-allowed-link').click();expect(await f.page.title()).toBe('SW Allow Listed');
  });
  it('retains popup protection when page code locks window.open',async()=>{
    const f=await fixture('/guard-warning-start');await f.page.locator('#guard-warning-popup-link').click();expect(f.session.takeBlockedNavigations().length).toBeGreaterThan(0);expect(f.session.context.pages()).toHaveLength(1);
    await f.page.locator('#guard-warning-allowed-link').click();expect(await f.page.title()).toBe('Guard Warning Allowed');
  });
});
