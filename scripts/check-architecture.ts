import { readFileSync } from 'node:fs';
import { checkArchitecture } from './architecture.ts';
import type { Manifest } from './architecture.ts';
const manifest: Manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const result = await checkArchitecture(process.cwd(), manifest);
for (const error of result.errors) console.error(error);
if (result.errors.length) process.exitCode = 1;
else console.log(`Architecture passed: ${result.files.length} production modules.`);
