#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execute, diagnosisFailed } from './runner.mjs';
export { validateConfig } from './runner.mjs';

export async function main(argv = process.argv.slice(2)) {
  const result = await execute(argv);
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  if (diagnosisFailed(result)) throw Error('Doctor found unavailable GitHub read capabilities or DSH command; inspect the named checks above');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
