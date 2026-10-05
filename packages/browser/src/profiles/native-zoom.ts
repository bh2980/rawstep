import { randomUUID } from 'node:crypto';
import { evaluateProfileArguments } from './page-script.js';
import type { Page } from 'playwright';
import type { NativeZoomController } from './ports.js';
const verifiedControllers = new WeakSet<NativeZoomController>();
export const isVerifiedZoomController = (controller: NativeZoomController): boolean => verifiedControllers.has(controller);
/** Uses Chromium's actual tabs zoom API in an explicitly installed, trusted extension page. */
export function createChromiumTabZoomController(extensionPage: Page, tabId: number): NativeZoomController {
  if (!extensionPage.url().startsWith('chrome-extension://') || !Number.isSafeInteger(tabId) || tabId < 0) throw new Error('Native zoom requires a trusted Chromium extension page and exact target tab id.');
  const controller: NativeZoomController = async (page, factor) => {
    if (!extensionPage.url().startsWith('chrome-extension://')) throw new Error('Zoom controller extension page changed origin.');
    if (extensionPage.context() !== page.context()) throw new Error('Zoom target must belong to the extension browser context.');
    const marker=randomUUID();
    await evaluateProfileArguments(page, (id:string)=>{Object.defineProperty(window,'__rawstepZoomTarget',{value:id,configurable:true});}, marker);
    const observedFactor = await evaluateProfileArguments(extensionPage, async ({ tabId, factor, expectedUrl, marker }) => {
      const chrome = (globalThis as unknown as { chrome: { tabs: { get(id:number):Promise<{url?:string}>;setZoom(id:number,factor:number):Promise<void>;getZoom(id:number):Promise<number>;setZoomSettings(id:number,settings:{mode:'automatic';scope:'per-tab'}):Promise<void>;getZoomSettings(id:number):Promise<{scope?:string}> };scripting:{executeScript(options:{target:{tabId:number};world:'MAIN';func:()=>unknown}):Promise<{result?:unknown}[]>} } }).chrome;
      if (!chrome?.tabs?.setZoom || !chrome.tabs.getZoom) throw new Error('Actual Chromium tabs zoom API is unavailable.');
      if ((await chrome.tabs.get(tabId)).url !== expectedUrl) throw new Error('Native zoom tab does not match the task page URL.');
      if(!chrome.scripting?.executeScript)throw new Error('Native zoom requires exact target-tab marker verification via extension scripting.');
      const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=> (window as unknown as {__rawstepZoomTarget?:string}).__rawstepZoomTarget});
      if(result.length!==1||result[0]?.result!==marker)throw new Error('Native zoom target is not the exact task page.');
      await chrome.tabs.setZoomSettings(tabId,{mode:'automatic',scope:'per-tab'});
      if((await chrome.tabs.getZoomSettings(tabId)).scope!=='per-tab')throw new Error('Native zoom must be scoped to the exact tab.');
      await chrome.tabs.setZoom(tabId, factor);
      return chrome.tabs.getZoom(tabId);
    }, { tabId, factor, expectedUrl: page.url(), marker });
    return { observedFactor, method: 'chrome.tabs.setZoom/getZoom; exact context and tab URL checked' };
  };
  verifiedControllers.add(controller); return controller;
}
