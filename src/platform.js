// The few things that differ between Linux, macOS and Windows: finding `claude`,
// opening a URL, desktop notifications, and where state files live.
import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFile = promisify(execFileCb);
export const run = async (cmd, args, opts = {}) => (await execFile(cmd, args, { maxBuffer: 1 << 20, windowsHide: true, ...opts })).stdout.trim();

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

// Env for Session processes: drop TMUX so a Session started from inside tmux can still attach.
export function childEnv() {
  const e = { ...process.env, COLORTERM: 'truecolor' };
  delete e.TMUX;
  delete e.TMUX_PANE;
  return e;
}

export function commandExists(name) {
  const exts = isWindows ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((x) => x.toLowerCase()) : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* keep looking */ }
    }
  }
  return null;
}

// How to start `claude`: { command, args } to prepend before claude's own arguments.
// A Windows .cmd shim can't be started directly, so it goes through cmd.exe.
async function findClaude() {
  const override = process.env.SCRATCHBOARD_CLAUDE;
  let file = override || commandExists('claude');
  if (!file && !isWindows) {
    // GUI-started shells may lack the user's PATH; ask a login shell.
    try { file = await run(process.env.SHELL || 'bash', ['-lc', 'command -v claude']); } catch { /* not found */ }
  }
  file ||= 'claude';
  if (isWindows && /\.(cmd|bat)$/i.test(file)) return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', file] };
  return { command: file, args: [] };
}
let claudePromise;
export const claudeCommand = () => (claudePromise ??= findClaude());

export function openUrl(url) {
  const [cmd, args] = isWindows ? ['cmd', ['/c', 'start', '""', url]] : isMac ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// Native desktop notifications where there's a simple CLI for them. On Windows the
// board page shows browser notifications instead (see nativeNotifications).
export const nativeNotifications = !isWindows && (isMac || Boolean(commandExists('notify-send')));
export function notify(title, body) {
  if (isMac) {
    const q = (s) => JSON.stringify(String(s));
    execFileCb('osascript', ['-e', `display notification ${q(body)} with title ${q(title)}`], () => {});
  } else if (nativeNotifications) {
    execFileCb('notify-send', ['--app-name=Scratchboard', title, body], () => {});
  }
}

export function stateDir() {
  const base = isWindows
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  const dir = path.join(base, 'scratchboard');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
