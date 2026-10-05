import { createBrowserSession as createSession, type CreateBrowserSessionOptions } from '@rawstep/browser/browser';
import { afterEach } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { OwnedResources } from './resources.js';
const sessions = new OwnedResources<Awaited<ReturnType<typeof createSession>>>();
const browsers = new OwnedResources<Browser>();
afterEach(async () => { await sessions.cleanup(); await browsers.cleanup(); });
/** Mandatory real-browser tests: install Playwright Chromium, or supply a trusted compatible executable. */
export const createTestBrowserSession=(url:string,options:CreateBrowserSessionOptions={})=>sessions.acquire(()=>createSession(url,{
  headless:true,...options,
  ...(process.env.RAWSTEP_TEST_BROWSER_PATH?{executablePath:process.env.RAWSTEP_TEST_BROWSER_PATH}:{}),
}));
export const launchTestBrowser = () => browsers.acquire(() => chromium.launch({ headless:true, chromiumSandbox:true,
  ...(process.env.RAWSTEP_TEST_BROWSER_PATH ? { executablePath:process.env.RAWSTEP_TEST_BROWSER_PATH } : {}) }));
