#!/usr/bin/env node
// Static HTML only. Upstream scripts and resources are never executed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
const args=Object.fromEntries(process.argv.slice(2).reduce((all,v,i,a)=>i%2?all:[...all,[v,a[i+1]]],[]));
if(!args['--evidence-root']||!args['--source']||!args['--out'])throw new Error('Required: --evidence-root ROOT --source PINNED_CHECKOUT --out FILE');
const root=args['--evidence-root'],source=args['--source'];
const records=[...JSON.parse(readFileSync(join(root,'nvda/nvda-observations.json'),'utf8')),...JSON.parse(readFileSync(join(root,'a11ysupport/normalized-v2/vo_macos-observations.json'),'utf8'))];
const doms=new Map();const text=e=>(e?.textContent??'').replace(/\s+/g,' ').trim();
const nav=new Set(['next_item','previous_item','next_focusable_item','previous_focusable_item','next_form_field','previous_form_field','next_button','next_link','next_unvisited_link','next_heading','previous_heading']);
const permittedRoles=new Set(['button','link','checkbox','radio','textbox','searchbox','combobox','heading','slider','spinbutton','img','main','navigation','banner','contentinfo','complementary','group','region','note','status','alert','tooltip','tab','switch','list','listitem']);
function role(el){const explicit=el.getAttribute('role')?.trim().split(/\s+/)[0];if(explicit)return explicit;const tag=el.localName,type=el.getAttribute('type')??'text';if(tag==='input')return ({button:'button',submit:'button',reset:'button',checkbox:'checkbox',radio:'radio',search:'searchbox',range:'slider',number:'spinbutton',password:'textbox'})[type]??'textbox';return ({button:'button',a:el.hasAttribute('href')?'link':null,textarea:'textbox',select:'combobox',img:'img',main:'main',nav:'navigation',aside:'complementary',ul:'list',ol:'list',li:'listitem',fieldset:'group'})[tag]??(/^h[1-6]$/.test(tag)?'heading':null)}
function name(el,doc){const refs=el.getAttribute('aria-labelledby');if(refs)return refs.split(/\s+/).map(id=>text(doc.getElementById(id))).join(' ').trim();if(el.hasAttribute('aria-label'))return el.getAttribute('aria-label').trim();if(el.labels?.length)return Array.from(el.labels).map(text).join(' ').trim();if(el.localName==='img'||(el.localName==='input'&&el.type==='image'))return el.getAttribute('alt')??'';if(el.localName==='input'&&['button','submit','reset'].includes(el.type))return el.value;if(['input','textarea','select'].includes(el.localName))return '';if(el.localName==='fieldset')return text(el.querySelector('legend'));return text(el)}
const extracted=records.map(r=>{
 const base={id:r.id,at:r.environment.at==='nvda'?'nvda':'voiceover',browser:r.environment.browser,atVersion:r.environment.atVersion,browserVersion:r.environment.browserVersion,osVersion:r.environment.osVersion,command:r.action.id,sourceUrl:r.source.url,sourcePointer:r.source.jsonPointer,sourceSha256:r.source.sha256,testedOn:r.environment.testedOn,reportedSpeech:r.reportedSpeech,reportedOutputRaw:r.reportedOutputRaw,qualityFlags:r.qualityFlags,featureProvenance:'static fixture + declared selector/setup, not native AX/focus telemetry',family:r.source.fixture?.path??r.source.path,status:'unsupported'};
 if(r.outputKind!=='quoted-reported-speech')return {...base,reason:`output:${r.outputKind}`};
 if(r.qualityFlags.length)return {...base,reason:`quality:${r.qualityFlags.join('|')}`};
 if(!nav.has(r.action.id))return {...base,reason:'command-needs-dynamic-or-unmodeled-context'};
 const f=r.source.fixture;if(!f)return {...base,reason:'source-fixture-unavailable'};
 let dom=doms.get(f.path);if(!dom){const bytes=readFileSync(join(source,f.path));if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new Error('Fixture hash mismatch '+f.path);dom=new JSDOM(bytes.toString('utf8'));doms.set(f.path,dom)}
 const doc=dom.window.document;let selector=r.declaredSetup.selector;if(!selector)return {...base,reason:'target-selector-missing'};
 // Explicitly scoped example number in the source test ID, never in its speech.
 const example=/\/links\/example(\d+):/.exec(r.id);let scope=example?doc.querySelector('#example-'+example[1]):doc;
 if(!scope)return {...base,reason:'declared-example-scope-unavailable'};
 let selectorRepair=false;if(/^role="[^"]+"/.test(selector)){selector=selector.replace(/^role="([^"]+)"/,'[role="$1"]');selectorRepair=true;}
 let targets;try{targets=[...scope.querySelectorAll(selector)]}catch{return {...base,reason:'invalid-source-selector'}}
 if(targets.length!==1)return {...base,reason:targets.length?'ambiguous-target-multiple-matches':'target-not-in-static-state'};
 const el=targets[0],rRole=role(el);if(!rRole||!permittedRoles.has(rRole))return {...base,reason:'role-unmodeled'};
 const accessibleName=name(el,doc);if(!accessibleName)return {...base,reason:'static-name-unavailable'};
 if(el.hasAttribute('aria-describedby')||el.hasAttribute('aria-description')||el.hasAttribute('aria-errormessage')||el.hasAttribute('title'))return {...base,reason:'description-or-hint-unmodeled'};
 let group=null;for(let p=el.parentElement;p&&p!==doc.body;p=p.parentElement){if(['group','main','navigation','banner','contentinfo','complementary','region','list','listitem'].includes(role(p))){group=p;break;}}
 if(group)return {...base,reason:'ancestor-context-unmodeled'};
 const flags={};for(const [attr,key] of [['aria-checked','checked'],['aria-pressed','pressed'],['aria-expanded','expanded'],['aria-selected','selected'],['aria-invalid','invalid'],['aria-haspopup','haspopup']]){const v=el.getAttribute(attr);if(v!==null&&v!==''&&v!=='undefined'&&!(key==='haspopup'&&v==='false')&&!(key==='invalid'&&v==='false'))flags[key]=v;}
 if(['checkbox','radio'].includes(rRole)&&flags.checked===undefined)flags.checked=String(el.hasAttribute('checked'));
 for(const [attr,aria,key] of [['disabled','aria-disabled','disabled'],['required','aria-required','required'],['readonly','aria-readonly','readonly']])if(el.hasAttribute(attr)||el.getAttribute(aria)==='true')flags[key]='true';
 if(el.localName==='textarea')flags.multiline='true';if(el.type==='password')return {...base,reason:'protected-value-not-learned'};
 let value='';if(['textbox','searchbox','spinbutton','slider'].includes(rRole)){value=el.getAttribute('aria-valuetext')??el.getAttribute('aria-valuenow')??(el.localName==='textarea'?el.value:el.getAttribute('value'))??'';if(rRole==='slider'&&!value)return {...base,reason:'static-value-unavailable'}}
 if(rRole==='combobox'){if(el.localName!=='select')return {...base,reason:'composite-dynamic-state-unavailable'};value=text(el.querySelector('option[selected]')??el.querySelector('option'));flags.expanded='false';}
 if(rRole==='heading'){const l=el.getAttribute('aria-level')??(/^h[1-6]$/.test(el.localName)?el.localName.slice(1):null);if(l)flags.level=l;}
 return {...base,status:'features-extracted',role:rRole,name:accessibleName,value,flags,selectorRepair,readingUnit:'single-static-target-assumption',beforeMode:r.declaredSetup.before?.mode??'unknown'};
});
// ARIA-AT rows remain in the denominator, but setup/action alignment is not invented.
const aria=JSON.parse(readFileSync(join(root,'aria-at/voiceover_observations.json'),'utf8')).records.map(r=>({id:r.id,at:'voiceover',browser:'safari',atVersion:r.environment.reported_at_version,browserVersion:r.environment.reported_browser_version,sourceUrl:r.provenance.report_url,family:'aria-at:'+r.test_plan.directory,status:'unsupported',reason:'aria-at-sequence-target-alignment-unmodeled',reportedOutputRaw:r.observed_output.verbatim}));
// Group semantically identical/near-clone fixtures without using output labels.
const semanticFamily=(doc)=>{const signature=[...doc.querySelectorAll('body *')].map(el=>{const r=role(el);if(!r)return null;const flags={};for(const [html,aria,key] of [['required','aria-required','required'],['disabled','aria-disabled','disabled'],['readonly','aria-readonly','readonly']])if(el.hasAttribute(html)||el.getAttribute(aria)==='true')flags[key]=true;for(const key of ['aria-pressed','aria-checked','aria-expanded','aria-selected','aria-haspopup'])if(el.hasAttribute(key))flags[key]=el.getAttribute(key);return{role:r,name:r==='heading'?'':name(el,doc),type:el.localName==='input'?el.type:undefined,flags};}).filter(Boolean);return signature.length?'semantic-fixture:'+createHash('sha256').update(JSON.stringify(signature)).digest('hex'):null;};
const families=new Map([...doms].map(([path,dom])=>[path,semanticFamily(dom.window.document)??path]));
for(const r of extracted){r.originalFamily=r.family;r.family=families.get(r.family)??r.family;}
for(let i=0;i<aria.length;i++){const original=JSON.parse(readFileSync(join(root,'aria-at/voiceover_observations.json'),'utf8')).records[i];const f=original.test.source_fixture;aria[i].originalFamily=aria[i].family;if(f?.file){const bytes=readFileSync(join(root,'aria-at',f.file));if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new Error('ARIA fixture hash mismatch');const dom=new JSDOM(bytes.toString('utf8'));aria[i].family=semanticFamily(dom.window.document)??aria[i].family;dom.window.close();}}
const all=[...extracted,...aria];mkdirSync(join(args['--out'],'..'),{recursive:true});writeFileSync(args['--out'],JSON.stringify(all,null,2)+'\n');
console.log(JSON.stringify({records:all.length,features:extracted.filter(r=>r.status==='features-extracted').length,reasons:all.reduce((o,r)=>{const k=r.reason??'features-extracted';o[k]=(o[k]??0)+1;return o},{})},null,2));
for(const dom of doms.values())dom.window.close();
