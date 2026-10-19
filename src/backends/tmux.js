// tmux backend, used whenever tmux is installed: each Session is a window in the
// repo's `sb-<repo>` tmux session, tagged with @sb_ticket so it can be found again.
// Sessions outlive Scratchboard itself, and you can attach from any terminal.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { run, childEnv, commandExists, isMac } from '../platform.js';

export function createTmuxBackend(repoRoot) {
  const sess = 'sb-' + path.basename(repoRoot).replace(/[^A-Za-z0-9_-]/g, '-');

  async function windows() {
    let out;
    try {
      out = await run('tmux', ['list-windows', '-t', `=${sess}`, '-F', '#{window_id}\t#{@sb_ticket}\t#{pane_dead}']);
    } catch { return new Map(); }
    const map = new Map();
    for (const line of out.split('\n')) {
      const [windowId, key, dead] = line.split('\t');
      if (key) map.set(key, { windowId, alive: dead !== '1' });
    }
    return map;
  }

  async function ensureSession() {
    try { await run('tmux', ['has-session', '-t', `=${sess}`]); }
    catch { await run('tmux', ['new-session', '-d', '-s', sess, '-n', 'board', '-c', repoRoot], { env: childEnv() }); }
  }

  return {
    name: 'tmux',
    label: `tmux session ${sess}`,
    async list() {
      return new Map([...(await windows())].map(([key, w]) => [key, { alive: w.alive }]));
    },
    // Reuses the Ticket's window when it has one (a Relaunch), otherwise opens a new one.
    async start({ key, name, cwd, command, args }) {
      const existing = (await windows()).get(key);
      if (existing) {
        await run('tmux', ['respawn-pane', '-k', '-c', cwd, '-t', existing.windowId, command, ...args], { env: childEnv() });
        return;
      }
      await ensureSession();
      const windowId = await run('tmux', ['new-window', '-d', '-P', '-F', '#{window_id}', '-t', `=${sess}:`, '-n', name, '-c', cwd, command, ...args], { env: childEnv() });
      await run('tmux', ['set-option', '-w', '-t', windowId, 'remain-on-exit', 'on']);
      await run('tmux', ['set-option', '-w', '-t', windowId, '@sb_ticket', key]);
    },
    async kill(key) {
      const w = (await windows()).get(key);
      if (w) await run('tmux', ['kill-window', '-t', w.windowId]).catch(() => {});
    },
    // Pops up a terminal window attached to the Session's tmux window.
    async open(key) {
      const w = (await windows()).get(key);
      if (!w) throw new Error('No tmux window for this Ticket');
      await run('tmux', ['select-window', '-t', w.windowId]);
      const attach = `tmux attach-session -t '=${sess}'`;
      let term;
      if (isMac) term = ['osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(attach)}`, '-e', 'tell application "Terminal" to activate']];
      else if (commandExists('ptyxis')) term = ['ptyxis', ['--new-window', '--', 'sh', '-c', attach]];
      else term = ['x-terminal-emulator', ['-e', 'sh', '-c', attach]];
      spawn(term[0], term[1], { detached: true, stdio: 'ignore', env: childEnv() }).unref();
      return { inBrowser: false };
    },
  };
}
