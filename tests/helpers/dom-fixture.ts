/**
 * Executes the real fixture HTML/scripts in a DOM implementation.
 * This deliberately does not emulate browser layout, native keyboard behavior,
 * HTTP navigation, accessibility trees or speech. Those need browser/native QA.
 */
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserSession } from '@rawstep/browser/browser';

export async function domFixture(name:string) {
  const path=resolve('fixtures',name);
  const dom=new JSDOM(await readFile(path,'utf8'),{url:pathToFileURL(path).href,runScripts:'dangerously'});
  const document=dom.window.document;
  const visible=(node:Element):boolean=> {
    let current:Element|null=node;
    while(current){
      const style=dom.window.getComputedStyle(current);
      if(current.hasAttribute('hidden')||style.display==='none'||style.visibility==='hidden')return false;
      current=current.parentElement;
    }
    return true;
  };
  const session={
    page:{
      title:async()=>document.title,
      url:()=>dom.window.location.href,
      getByText:(text:string,options:{exact:boolean})=>{
        const matches=[...document.querySelectorAll('body *')].filter(node=>{
          const content=(node.textContent??'').trim();
          return options.exact?content===text:content.includes(text);
        });
        return {count:async()=>matches.length,nth:(index:number)=>({isVisible:async()=>visible(matches[index])})};
      },
    },
    network:{requests:[],responses:[]},domEvents:[],close:async()=>dom.window.close(),
  } as unknown as BrowserSession;
  function element<T extends HTMLElement=HTMLElement>(selector:string):T {
    const match=document.querySelector(selector);if(!match)throw new Error(`Fixture element missing: ${selector}`);return match as T;
  }
  function fill(selector:string,value:string){const field=element<HTMLInputElement>(selector);field.value=value;field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
  function submit(selector:string){return element<HTMLFormElement>(selector).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));}
  return {dom,document,session,element,fill,submit};
}
