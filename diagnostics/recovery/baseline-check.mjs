// Generates OPTIONAL targeted read-only SQL. No connection or credentials.
import fs from 'node:fs';
import { sections,locateQuery } from './baseline-metadata.mjs';
import { reportedLocateQuery,targetedDetailQuery } from './baseline-diagnostics.mjs';
const [mode,section,entity,member]=process.argv.slice(2);
const expected=()=>JSON.parse(fs.readFileSync(new URL('./baseline-audit/expected-metadata.json',import.meta.url),'utf8'));
if(mode==='locate-reported'){
  const report=JSON.parse(fs.readFileSync(new URL('./baseline-audit/production-result.json',import.meta.url),'utf8'));
  process.stdout.write(reportedLocateQuery(expected(),report));
}else if(!['locate','detail'].includes(mode)||!Object.hasOwn(sections,section)||mode==='detail'&&!entity){
  console.error('Usage: node diagnostics/recovery/baseline-check.mjs locate-reported\n       node diagnostics/recovery/baseline-check.mjs locate <section>\n       node diagnostics/recovery/baseline-check.mjs detail <section> <object> [member]');
  process.exitCode=1;
}else{
  const contract=expected();
  process.stdout.write(mode==='locate'?locateQuery(section,contract.sections[section].entities):targetedDetailQuery(contract,section,entity,member));
}
