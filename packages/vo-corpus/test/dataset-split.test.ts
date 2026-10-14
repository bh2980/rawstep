import assert from "node:assert/strict";
import test from "node:test";
import { planDatasetSplit } from "../src/dataset-split.js";

test("split keeps template siblings, site siblings and contrast pairs connected and excludes calibrated components from tests",()=>{
  const items=[
    {id:'vo-a',templateGroup:'one',siteGroup:'publisher',exposure:'unseen' as const},
    {id:'nvda-a',templateGroup:'one',contrastGroup:'pair',exposure:'unseen' as const},
    {id:'vo-b',templateGroup:'two',contrastGroup:'pair',exposure:'unseen' as const},
    {id:'blog',templateGroup:'three',siteGroup:'publisher',exposure:'calibration' as const},
    {id:'new',templateGroup:'four',exposure:'unseen' as const},
  ];
  const result=planDatasetSplit(items,'fixed');
  assert.equal(result.groups.length,2);
  const connected=result.groups.find(g=>g.members.includes('vo-a'))!;
  assert.deepEqual(connected.members,['blog','nvda-a','vo-a','vo-b']);
  assert.equal(connected.split,'train');assert.equal(connected.calibrationForced,true);
  assert.deepEqual(planDatasetSplit([...items].reverse(),'fixed'),result);
  assert.throws(()=>planDatasetSplit([{id:'legacy',templateGroup:'',exposure:'unseen'}],'fixed'),/Explicit/);
  assert.throws(()=>planDatasetSplit([items[0]!,items[0]!],'fixed'),/unique/);
});

test("new browser siblings keep an input group stable, and frozen split merges cannot leak across partitions",()=>{
  const first={id:'voiceover',templateGroup:'widget',exposure:'unseen' as const};
  const original=planDatasetSplit([first],'fixed').groups[0]!;
  const extended=planDatasetSplit([first,{...first,id:'nvda'}],'fixed').groups[0]!;
  assert.equal(extended.id,original.id);assert.equal(extended.split,original.split);
  const frozen=planDatasetSplit([{...first,fixedSplit:'test'},{...first,id:'nvda'}],'fixed');
  assert.equal(frozen.groups[0]!.split,'test');
  assert.throws(()=>planDatasetSplit([{...first,fixedSplit:'train'},{...first,id:'other',fixedSplit:'test'}],'fixed'),/Frozen assignments conflict/);
  assert.throws(()=>planDatasetSplit([{...first,exposure:'calibration',fixedSplit:'test'}],'fixed'),/Frozen assignments conflict/);
});
