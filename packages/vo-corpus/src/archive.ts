import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { casesFingerprint, type CaseSet } from "./cases.js";

/** Keep the actual input bytes with a new run; never replace a previous archive. */
export async function archiveCaseInputs(casesDir: string, runDir: string, set: CaseSet, expectedHash: string) {
  const archive = join(runDir,"inputs"), files: {path:string;sha256:string;bytes:number}[] = [];
  for (const path of ["cases.json", ...new Set(set.cases.map(c=>c.page).filter(Boolean))].sort()) {
    const source = resolve(casesDir,path), rel = relative(resolve(casesDir),source);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Fixture path escapes case directory: ${path}`);
    const bytes = await readFile(source), target = join(archive,rel);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,bytes,{flag:"wx"});
    files.push({path:rel,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length});
  }
  if (await casesFingerprint(archive,set) !== expectedHash) throw new Error("Fixture changed during input archival; collection has not started");
  const split = await readFile(join(casesDir,"split.json")).catch(error=>{
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (split) {
    const plan=JSON.parse(split.toString());
    if (!Array.isArray(plan.sources) || !plan.sources.some((s:{caseSet:string;casesSha256:string})=>s.caseSet===set.id&&s.casesSha256===expectedHash)) throw new Error("Split plan is not pinned to current case bytes");
    await writeFile(join(archive,"split.json"),split,{flag:"wx"});
    files.push({path:"split.json",sha256:createHash("sha256").update(split).digest("hex"),bytes:split.length});
  }
  const manifest = JSON.stringify({schemaVersion:1,casesSha256:expectedHash,files},null,2);
  await writeFile(join(archive,"manifest.json"),manifest,{flag:"wx"});
  return {directory:"inputs",manifestSha256:createHash("sha256").update(manifest).digest("hex")};
}
