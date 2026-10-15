import assert from 'node:assert/strict';import test from 'node:test';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
test('native custom-content capture preserves archive bytes and distinguishes empty, invalid, oversized and unavailable data',{skip:process.platform!=='darwin'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vo-content-'));
 try{
  const source=await readFile(new URL('../axdump/custom-content.swift',import.meta.url),'utf8');
  const checks=`
let entry = AXCustomContent(label: "description", value: "Copies, not originals.")
entry.importance = .high
let data = try NSKeyedArchiver.archivedData(withRootObject: [entry], requiringSecureCoding: true)
let result = captureCustomContent(data as NSData, limit: { $0 })
assert(result["status"] as? String == "observed")
assert(Data(base64Encoded: result["rawBase64"] as! String) == data)
let entries = result["entries"] as! [[String: Any]]
assert(entries[0]["value"] as? String == "Copies, not originals.")
assert(entries[0]["importance"] as? UInt == 1)
let empty = try NSKeyedArchiver.archivedData(withRootObject: [AXCustomContent](), requiringSecureCoding: true)
assert((captureCustomContent(empty as NSData, limit: { $0 })["entries"] as! [[String: Any]]).isEmpty)
assert(captureCustomContent(nil, limit: { $0 })["status"] as? String == "unavailable")
assert(captureCustomContent(Data(count:65537) as NSData, limit: { $0 })["status"] as? String == "too-large")
assert(captureCustomContent(Data("invalid".utf8) as NSData, limit: { $0 })["status"] as? String == "decode-error")
print("passed")
`;
  await writeFile(join(dir,'main.swift'),source+checks);await exec('swiftc',[join(dir,'main.swift'),'-o',join(dir,'test')]);assert.equal((await exec(join(dir,'test'))).stdout.trim(),'passed');
 }finally{await rm(dir,{recursive:true,force:true});}
});
