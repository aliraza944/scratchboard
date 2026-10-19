#!/usr/bin/env node
// Usage:
//   scratchboard [dir] [--port N] [--backend auto|tmux|pty] [--no-open] [--foreground]
//   scratchboard stop [dir]
//
// By default the board runs in the background, one per repo, so it keeps going after
// you close the terminal. Running it again for the same repo just reopens the page.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';
import { openUrl, stateDir } from '../src/platform.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const positional = args.filter((a, i) => !a.startsWith('--') && !['--port', '--backend'].includes(args[i - 1]));
const command = positional[0] === 'stop' ? 'stop' : 'start';
const dir = (command === 'stop' ? positional[1] : positional[0]) ?? process.cwd();
const port = Number(option('--port', 4747));
const backend = option('--backend', process.env.SCRATCHBOARD_BACKEND ?? 'auto');

// The board is for exactly this directory: no walking up to a parent's .scratch.
const repoRoot = path.resolve(dir);
if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
  console.error(`Not a directory: ${repoRoot}`);
  process.exit(1);
}

const id = crypto.createHash('sha1').update(repoRoot).digest('hex').slice(0, 12);
const stateFile = path.join(stateDir(), `${path.basename(repoRoot).replace(/[^\w.-]/g, '_')}-${id}.json`);
const logFile = stateFile.replace(/\.json$/, '.log');

const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; } };

// The running board for this repo, if any: its state file plus a live /api/ping.
async function running() {
  const st = readState();
  if (!st) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${st.port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    if (body.app === 'scratchboard' && body.repoRoot === repoRoot) return { ...st, backend: body.backend };
  } catch { /* stale */ }
  fs.rmSync(stateFile, { force: true });
  return null;
}

function show(st) {
  console.log(`Scratchboard for ${repoRoot}\n${st.url}  (Sessions: ${st.backend})`);
  if (!flag('--no-open')) openUrl(st.url);
}

if (command === 'stop') {
  const st = await running();
  if (!st) { console.log(`No Scratchboard running for ${repoRoot}.`); process.exit(0); }
  try { process.kill(st.pid); } catch { /* already gone */ }
  fs.rmSync(stateFile, { force: true });
  console.log(`Stopped Scratchboard for ${repoRoot}.${st.backend === 'pty' ? ' Its Sessions ended too; Relaunch resumes them.' : ''}`);
} else if (flag('--foreground')) {
  if (!fs.existsSync(path.join(repoRoot, '.scratch'))) {
    console.log(`No .scratch folder in ${repoRoot} yet. The board will show Tickets as soon as one appears.`);
  }
  let board;
  try {
    board = await startServer({
      repoRoot, port, backend,
      onListening({ url, port: actual, backend: b }) {
        fs.writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port: actual, url, repoRoot, backend: b.name }));
        show({ url, backend: b.name });
      },
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const quit = () => { if (readState()?.pid === process.pid) fs.rmSync(stateFile, { force: true }); board.stop(); process.exit(0); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
} else {
  const st = await running();
  if (st) {
    if (option('--backend') && option('--backend') !== st.backend) {
      console.log(`Already running with the ${st.backend} backend. Run \`scratchboard stop\` first to switch.`);
    }
    show(st);
  } else {
    // Start ourselves again in the foreground, detached, logging to a file.
    const self = fileURLToPath(import.meta.url);
    const out = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, [self, repoRoot, '--foreground', '--no-open', '--port', String(port), '--backend', backend], {
      detached: true, stdio: ['ignore', out, out], windowsHide: true,
    });
    child.unref();
    let started = null;
    for (let i = 0; i < 50 && !started; i++) {
      await new Promise((r) => setTimeout(r, 200));
      started = readState()?.pid === child.pid ? readState() : null;
      if (child.exitCode !== null) break;
    }
    if (!started) {
      console.error(`Scratchboard didn't start. See ${logFile}`);
      process.exit(1);
    }
    show(started);
    console.log(`Running in the background. Stop it with: scratchboard stop${repoRoot === process.cwd() ? '' : ' ' + repoRoot}`);
  }
}
