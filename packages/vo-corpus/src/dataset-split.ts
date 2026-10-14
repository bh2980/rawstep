import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { casesFingerprint, type CaseSet } from "./cases.js";

type Item = {id:string;templateGroup:string;siteGroup?:string;contrastGroup?:string;exposure:"calibration"|"unseen";fixedSplit?:"train"|"validation"|"test"};
/** Split complete connected input groups, never utterance rows or observed outputs. */
export function planDatasetSplit(items: Item[], seed: string) {
  if (!seed || new Set(items.map(i=>i.id)).size!==items.length) throw new Error("A seed and unique sample IDs are required");
  const parent=items.map((_,i)=>i), find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]!));
  const owners=new Map<string,number>();
  items.forEach((item,i)=>{
    if (!item.templateGroup || !['calibration','unseen'].includes(item.exposure)) throw new Error("Explicit templateGroup and exposure are required; legacy data is not an unseen holdout");
    for (const key of [`template:${item.templateGroup}`,...(item.siteGroup?[`site:${item.siteGroup}`]:[]),...(item.contrastGroup?[`contrast:${item.contrastGroup}`]:[])]) {
      const owner=owners.get(key);
      if(owner!==undefined)parent[find(i)]=find(owner);else owners.set(key,i);
    }
  });
  const components=new Map<number,Item[]>();
  items.forEach((item,i)=>{const key=find(i),members=components.get(key)??[];members.push(item);components.set(key,members);});
  const groups=[...components.values()].map(members=>{
    const ids=members.map(i=>i.id).sort();
    const inputGroups=[...new Set(members.flatMap(i=>[`template:${i.templateGroup}`,...(i.siteGroup?[`site:${i.siteGroup}`]:[]),...(i.contrastGroup?[`contrast:${i.contrastGroup}`]:[])]))].sort();
    const id=createHash("sha256").update(JSON.stringify(inputGroups)).digest("hex");
    const calibrated=members.some(i=>i.exposure==='calibration'), bucket=Number.parseInt(createHash("sha256").update(seed+'\0'+id).digest("hex").slice(0,8),16)%100;
    const fixed=[...new Set(members.flatMap(i=>i.fixedSplit?[i.fixedSplit]:[]))];
    if(fixed.length>1||calibrated&&fixed.some(s=>s!=='train'))throw new Error('Frozen assignments conflict with a group merge or calibration exposure; review the split');
    return {id,inputGroups,members:ids,split:fixed[0]??(calibrated||bucket<70?'train':bucket<85?'validation':'test'),calibrationForced:calibrated};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  return {schemaVersion:2,seed,policy:"70/15/15 hash buckets over connected input group IDs; respect frozen assignments, reject conflicting merges, force unassigned calibration groups to train",groups,
    note:"Freeze before native observation. Small group counts need not attain nominal ratios. All AT/browser/version siblings must carry the same input group IDs; near-clone review can merge groups before freezing. No speech outputs participate."};
}

if(import.meta.url===pathToFileURL(process.argv[1]??"").href){
  const [out,seed,...directories]=process.argv.slice(2);
  if(!out||!seed||!directories.length)throw new Error("Usage: dataset-split.ts <new output.json> <seed> <cases directory>...");
  const items:Item[]=[],sources:{caseSet:string;casesSha256:string}[]=[];
  for(const dir of directories.map(p=>resolve(p))){
    const set=JSON.parse(await readFile(join(dir,'cases.json'),'utf8')) as CaseSet;
    sources.push({caseSet:set.id,casesSha256:await casesFingerprint(dir,set)});
    for(const c of set.cases){
      if(c.url&&!c.axes.siteGroup)throw new Error(`Public case ${c.id} requires an explicit siteGroup (including related subdomains/templates)`);
      items.push({id:`${set.id}/${c.id}`,templateGroup:c.axes.templateGroup!,exposure:c.axes.exposure as Item['exposure'],...(c.axes.siteGroup?{siteGroup:c.axes.siteGroup}:{}),...(c.axes.contrastGroup?{contrastGroup:c.axes.contrastGroup}:{}),...(['train','validation','test'].includes(c.axes.partition??'')?{fixedSplit:c.axes.partition as Item['fixedSplit']}:{})});
    }
  }
  const result={...planDatasetSplit(items,seed),sources};
  await writeFile(resolve(out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result.groups.map(g=>({split:g.split,cases:g.members.length,calibrationForced:g.calibrationForced})),null,2));
}
