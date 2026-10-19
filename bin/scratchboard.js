#!/usr/bin/env node
// Usage: scratchboard [repo-dir] [--port N] [--no-open]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../src/server.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 4747;
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') ?? process.cwd();

// The board is for exactly this directory: no walking up to a parent's .scratch.
const repoRoot = path.resolve(dir);
if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
  console.error(`Not a directory: ${repoRoot}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(repoRoot, '.scratch'))) {
  console.log(`No .scratch folder in ${repoRoot} yet. The board will show Tickets as soon as one appears.`);
}

startServer({
  repoRoot,
  port,
  onListening(url) {
    console.log(`Scratchboard for ${repoRoot}\n${url}`);
    if (!flag('--no-open')) spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  },
});
