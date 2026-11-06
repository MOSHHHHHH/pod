'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'files', 'podcast_processor_v2.js'), 'utf8');
const sandbox = { console, Date, JSON, Math };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { timeout: 10000 });
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!Array.isArray(input)) throw Error('Expected description array');
const output = input.map(raw => {
  const processed = sandbox.normalizePodcastDescription(raw);
  return { processed, timestamped: sandbox.convertTimestampsToLrc(processed),
    stable: sandbox.normalizePodcastDescription(processed) === processed };
});
process.stdout.write(JSON.stringify(output));
