// Starts, finds and ends Sessions. Each Session is one tmux window in the repo's
// `sb-<repo>` tmux session, tagged with window options so it can be found again.
import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const execFile = promisify(execFileCb);
const run = async (cmd, args, opts = {}) => (await execFile(cmd, args, { maxBuffer: 1 << 20, ...opts })).stdout.trim();

export const tmuxSessionName = (repoRoot) => 'sb-' + path.basename(repoRoot).replace(/[^A-Za-z0-9_-]/g, '-');
export const ticketKey = (feature, ticket) => `${feature}/${ticket.name}`;

// Env for child processes: drop TMUX so attaching from inside tmux doesn't refuse to nest.
const childEnv = () => { const e = { ...process.env }; delete e.TMUX; delete e.TMUX_PANE; return e; };

async function resolveClaude() {
  if (process.env.SCRATCHBOARD_CLAUDE) return process.env.SCRATCHBOARD_CLAUDE;
  try { return await run('bash', ['-lc', 'command -v claude']); } catch { return 'claude'; }
}
const claudeBin = resolveClaude();

// Map of ticket key -> { windowId, sessionId, alive, cwd }.
export async function listSessions(repoRoot) {
  const sess = tmuxSessionName(repoRoot);
  let out;
  try {
    out = await run('tmux', ['list-windows', '-t', `=${sess}`, '-F', '#{window_id}\t#{@sb_ticket}\t#{@sb_session}\t#{pane_dead}\t#{pane_current_path}']);
  } catch { return new Map(); }
  const map = new Map();
  for (const line of out.split('\n')) {
    const [windowId, key, sessionId, dead, cwd] = line.split('\t');
    if (!key) continue;
    map.set(key, { windowId, sessionId, alive: dead !== '1', cwd });
  }
  return map;
}

async function ensureTmuxSession(repoRoot) {
  const sess = tmuxSessionName(repoRoot);
  try { await run('tmux', ['has-session', '-t', `=${sess}`]); }
  catch { await run('tmux', ['new-session', '-d', '-s', sess, '-n', 'board', '-c', repoRoot], { env: childEnv() }); }
  return sess;
}

async function isGitRepo(repoRoot) {
  try { return (await run('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel'])) !== ''; } catch { return false; }
}

// A worktree per Ticket, beside the repo: ../<repo>-worktrees/<feature>-<ticket>.
async function ensureWorktree(repoRoot, feature, ticket) {
  const top = await run('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel']);
  const dir = path.join(path.dirname(top), `${path.basename(top)}-worktrees`, `${feature}-${ticket.name}`);
  if (fs.existsSync(dir)) return dir;
  const branch = `sb/${feature}/${ticket.name}`;
  let branchExists = true;
  try { await run('git', ['-C', top, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); } catch { branchExists = false; }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await run('git', ['-C', top, 'worktree', 'add', ...(branchExists ? [dir, branch] : ['-b', branch, dir])]);
  return dir;
}

// Grill Sessions only talk, so they run in the main checkout; implement Sessions get a worktree.
export async function launchSession({ repoRoot, feature, ticket, prompt, useWorktree = true }) {
  const sess = await ensureTmuxSession(repoRoot);
  const cwd = useWorktree && (await isGitRepo(repoRoot)) ? await ensureWorktree(repoRoot, feature.slug, ticket) : repoRoot;
  const sessionId = crypto.randomUUID();
  const text = prompt(cwd);
  const windowId = await run('tmux', [
    'new-window', '-d', '-P', '-F', '#{window_id}', '-t', `=${sess}:`, '-n', ticket.name, '-c', cwd,
    await claudeBin, '--session-id', sessionId, text,
  ], { env: childEnv() });
  await tagWindow(windowId, ticketKey(feature.slug, ticket), sessionId);
  return { sessionId, windowId, cwd };
}

async function tagWindow(windowId, key, sessionId) {
  await run('tmux', ['set-option', '-w', '-t', windowId, 'remain-on-exit', 'on']);
  await run('tmux', ['set-option', '-w', '-t', windowId, '@sb_ticket', key]);
  await run('tmux', ['set-option', '-w', '-t', windowId, '@sb_session', sessionId]);
}

// Restarts an ended Session in its window, resuming the same conversation.
export async function relaunchSession({ repoRoot, feature, ticket, existing, sessionId, useWorktree = true }) {
  if (existing) {
    await run('tmux', ['respawn-pane', '-k', '-t', existing.windowId, await claudeBin, '--resume', sessionId], { env: childEnv() });
    return existing.windowId;
  }
  // The window was closed: open a new one in the same place.
  const sess = await ensureTmuxSession(repoRoot);
  const cwd = useWorktree && (await isGitRepo(repoRoot)) ? await ensureWorktree(repoRoot, feature.slug, ticket) : repoRoot;
  const windowId = await run('tmux', [
    'new-window', '-d', '-P', '-F', '#{window_id}', '-t', `=${sess}:`, '-n', ticket.name, '-c', cwd,
    await claudeBin, '--resume', sessionId,
  ], { env: childEnv() });
  await tagWindow(windowId, ticketKey(feature.slug, ticket), sessionId);
  return windowId;
}

export async function killSession(existing) {
  if (existing) await run('tmux', ['kill-window', '-t', existing.windowId]).catch(() => {});
}

// Pops up a terminal window attached to the Session's tmux window.
export async function openTerminal(repoRoot, existing) {
  const sess = tmuxSessionName(repoRoot);
  await run('tmux', ['select-window', '-t', existing.windowId]);
  const attach = ['tmux', 'attach-session', '-t', `=${sess}`];
  const term = fs.existsSync('/usr/bin/ptyxis') ? ['ptyxis', '--new-window', '--', ...attach] : ['x-terminal-emulator', '-e', ...attach];
  spawn(term[0], term.slice(1), { detached: true, stdio: 'ignore', env: childEnv() }).unref();
}

export function notify(title, body) {
  execFileCb('notify-send', ['--app-name=Scratchboard', title, body], () => {});
}
