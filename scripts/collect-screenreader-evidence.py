#!/usr/bin/env python3
"""Normalize observed command outputs from a commit-pinned a11ysupport checkout.
Reads committed data with git show; never executes upstream code or uses assertion
expectation text as observed speech. Requires an already-authorized local clone.
"""
import argparse,collections,datetime,hashlib,json,pathlib,re,subprocess
PIN='6730ad42e83dd780f63555ab3f14f1c26ea0fae5'
REPO='https://github.com/accessibilitysupported/a11ysupport.io'
def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--at',choices=['nvda','vo_macos'],default='nvda');a=p.parse_args()
 def git(*args):return subprocess.check_output(['git','-C',str(a.source),*args])
 assert git('rev-parse',PIN).decode().strip()==PIN
 cache={}
 def read(path):
  if path not in cache:cache[path]=git('show',PIN+':'+path)
  return cache[path]
 def sha(data):return hashlib.sha256(data).hexdigest()
 def url(path):return REPO+'/blob/'+PIN+'/'+path
 meta=json.loads(read('data/ATBrowsers.json'));at=meta['at'][a.at];out=[]
 paths=git('ls-tree','-r','--name-only',PIN,'data/tests').decode().splitlines()
 for path in paths:
  if not path.endswith('.json'):continue
  source=read(path);d=json.loads(source);test=path[len('data/tests/'):-5]
  for browser,commands in d.get('commands',{}).get(a.at,{}).items():
   version=d.get('versions',{}).get(a.at,{}).get('browsers',{}).get(browser,{})
   for i,c in enumerate(commands):
    raw=c.get('output');text=raw.strip() if isinstance(raw,str) else '';flags=[]
    if not text:kind='missing-output';flags.append('missing-output')
    elif re.search(r'<(?:name|level|value|text)>|\{(?:number|name|value)\}',text,re.I):kind='generalized-template';flags.append('placeholder-not-literal')
    elif re.search(r'no (?:output|announcement|speech)|nothing was (?:conveyed|announced)|^silence\b',text,re.I):kind='reported-no-output';flags.append('no-output-description-not-spoken-text')
    elif re.search(r'(?:character|key|value) was announced|characters were announced|^in (?:the )?list|^\(.*\)$',text,re.I):kind='behavior-description';flags.append('behavior-prose-not-transcript')
    elif '...' in text or '…' in text:kind='abridged-reported-output';flags.append('abridged-output')
    elif re.search(r'"\s+or\s+"|when value is changed|when expanded:',text,re.I):kind='conditional-reported-output';flags.append('conditional-or-multiple-results')
    elif text.startswith('"') and text.endswith('"'):kind='quoted-reported-speech'
    else:kind='unclassified-reported-output';flags.append('literal-status-unreviewed')
    if test=='tech/aria/aria-expanded' and a.at=='nvda' and c.get('command')=='next_focusable_item':
     selector=c.get('css_target','')
     if ('="false"' in selector and 'expanded' in text and 'collapsed' not in text) or ('="true"' in selector and 'collapsed' in text and 'expanded' not in text):flags.append('state-output-contradiction')
    if a.at=='nvda' and c.get('command') in ['next_item','previous_item'] and text.lower().count('checkbox')>1:flags.append('multi-control-reading-unit')
    if a.at=='nvda' and c.get('command') in ['next_item','previous_item'] and text.lower().count('radio button')>1:flags.append('multi-control-reading-unit')
    if a.at=='nvda' and test=='tech/html/textarea' and c.get('command')=='next_focusable_item':flags.append('reported-value-may-be-incomplete')
    if any(not version.get(k) for k in ['at_version','browser_version','os_version']):flags.append('missing-environment-version')
    record={'id':f'a11ysupport:{test}:{a.at}:{browser}:{i}','evidenceKind':'third-party-reported-observation','nativeMeasurementByRawstep':False,
     'source':{'repository':REPO,'commit':PIN,'path':path,'sha256':sha(source),'jsonPointer':f'/commands/{a.at}/{browser}/{i}','url':url(path),'reportUrl':'https://a11ysupport.io/tests/'+test.replace('/','__'),'testTitle':d.get('title'),'attribution':'Michael Fairchild and Accessibility Supported contributors','license':'Site text/data CC-BY-4.0 grant; repository/FAQ GPL notices also retained in attribution documentation'},
     'environment':{'at':a.at,'atName':at['title'],'atVersion':version.get('at_version'),'browser':browser,'browserVersion':version.get('browser_version'),'os':at.get('os'),'osVersion':version.get('os_version'),'testedOn':version.get('date'),'locale':None,'quickNav':None,'verbosity':None,'voice':None,'punctuation':None,'typingEcho':None,'layout':None,'actualOperatingMode':None},
     'action':{'id':c.get('command'),'definition':at.get('commands',{}).get(c.get('command')),'definitionSource':url('data/ATBrowsers.json')},
     'declaredSetup':{'selector':c.get('css_target'),'before':c.get('before'),'afterTarget':c.get('after'),'meaning':'Source test setup and intended target, not separately captured native focus/cursor telemetry'},
     'observedCursor':None,'observedKeyboardFocus':None,'reportedOutputRaw':raw,
     'reportedSpeech':text[1:-1] if kind=='quoted-reported-speech' else None,'outputKind':kind,'qualityFlags':flags,
     'quality':{'audioVerified':False,'rawCaptureAvailable':False,'independentlyReproduced':False,'settingsUnknown':True,'sourceSetupNotObservedFocus':True},
     'sourceCommand':c}
    if d.get('html_file'):
     hp='data/tests/html/'+d['html_file']
     if hp in paths:record['source']['fixture']={'path':hp,'url':url(hp),'sha256':sha(read(hp)),'historicalMatchUnknown':True}
    out.append(record)
 a.out.mkdir(parents=True,exist_ok=True)
 dest=a.out/(a.at+'-observations.json');dest.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
 groups=collections.defaultdict(lambda:{'records':0,'eligibleReportedSpeechRecords':0,'qualityFlagCounts':collections.Counter()})
 for r in out:
  e=r['environment'];key=(e['at'],e['atVersion'],e['browser'],e['browserVersion'],e['osVersion']);g=groups[key];g['records']+=1
  if r['outputKind']=='quoted-reported-speech' and not r['qualityFlags']:g['eligibleReportedSpeechRecords']+=1
  g['qualityFlagCounts'].update(r['qualityFlags'])
 summary={'schemaVersion':'1.0','sourceRepository':REPO,'sourceCommit':PIN,'at':a.at,'collectedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'records':len(out),'testBrowserSets':len({(r['source']['path'],r['environment']['browser']) for r in out}),'browsers':dict(collections.Counter(r['environment']['browser'] for r in out)),'outputKinds':dict(collections.Counter(r['outputKind'] for r in out)),'qualityFlags':dict(collections.Counter(f for r in out for f in r['qualityFlags'])),'datasetSha256':sha(dest.read_bytes()),'groups':[{'at':k[0],'atVersion':k[1],'browser':k[2],'browserVersion':k[3],'osVersion':k[4],**v,'qualityFlagCounts':dict(v['qualityFlagCounts'])} for k,v in sorted(groups.items(),key=lambda x:tuple(str(y) for y in x[0]))]}
 (a.out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
 assert len({r['id'] for r in out})==len(out)
 for r in out:
  raw=json.loads(read(r['source']['path']))
  for key in r['source']['jsonPointer'].strip('/').split('/'):raw=raw[int(key)] if isinstance(raw,list) else raw[key]
  assert raw==r['sourceCommand'] and raw.get('output')==r['reportedOutputRaw']
 (a.out/'validation.json').write_text(json.dumps({'status':'passed','sourceRecordEquality':len(out),'commit':PIN,'sha256':summary['datasetSha256'],'settingsPreservedUnknown':True,'sourceSetupNotRelabeledObservedFocus':True},indent=2)+'\n')
 print(json.dumps({k:v for k,v in summary.items() if k!='groups'},indent=2))
if __name__=='__main__':main()
