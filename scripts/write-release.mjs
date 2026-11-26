import { access, writeFile } from 'node:fs/promises';

const commit = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('A full Git commit SHA is required.');
await access('dist/server/index.js');
await writeFile('dist/client/release.json', JSON.stringify({ schema: 1, commit, builtAt: new Date().toISOString() }) + '\n');
console.log(`Verified build stamped: ${commit}`);
