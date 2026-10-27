// Starts, finds and ends Sessions. The terminal side is a backend: tmux whenever
// it's installed, otherwise Scratchboard's own pty terminal (see src/backends/).
// This layer adds what every backend shares: worktrees and the Harness's command
// (`claude`, or `codex` when it's installed and picked at Launch).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run, commandExists, claudeCommand, codexCommand } from './platform.js';
import { discoverCodexSession } from './codex.js';
import { createTmuxBackend } from './backends/tmux.js';

export const ticketKey = (feature, ticket) => `${feature}/${ticket.name}`;
// A Map's chart or slice Session runs under the Feature's `<slug>/map` key. Ticket names
// start with their number, so it can't clash with a Ticket's key.
// mapTarget is what launch/relaunch take in place of a Ticket for it.
export const mapTarget = (slug) => ({ name: 'map', windowName: `${slug}-map` });
export const mapKey = (slug) => ticketKey(slug, mapTarget(slug));
export const BACKENDS = ['tmux', 'pty'];
export const HARNESSES = ['claude', 'codex'];

// `auto` (the default) means tmux if it's on the PATH, else pty.
export async function createSessions(repoRoot, requested = 'auto') {
  const name = requested === 'auto' ? (commandExists('tmux') ? 'tmux' : 'pty') : requested;
  if (!BACKENDS.includes(name)) throw new Error(`Unknown backend "${requested}". Use ${BACKENDS.join(', ')} or auto.`);
  if (name === 'tmux' && !commandExists('tmux')) throw new Error('The tmux backend needs tmux on your PATH. Use --backend pty instead.');
  // node-pty is a native module: only load it when it's actually used.
  const backend = name === 'tmux' ? createTmuxBackend(repoRoot) : (await import('./backends/pty.js')).createPtyBackend();

  async function cwdFor(feature, ticket, useWorktree) {
    return useWorktree && (await isGitRepo(repoRoot)) ? ensureWorktree(repoRoot, feature.slug, ticket) : repoRoot;
  }

  const codex = await codexCommand();
  const harnesses = codex ? HARNESSES : ['claude'];

  async function start(feature, ticket, cwd, harness, harnessArgs) {
    const cli = harness === 'codex' ? codex : await claudeCommand();
    await backend.start({ key: ticketKey(feature.slug, ticket), name: ticket.windowName ?? ticket.name, cwd, command: cli.command, args: [...cli.args, ...harnessArgs] });
  }

  function checkHarness(harness) {
    if (!harnesses.includes(harness)) throw new Error(harness === 'codex' ? 'codex is not installed (or set SCRATCHBOARD_CODEX)' : `Unknown harness "${harness}"`);
  }

  // A worktree Session edits the Ticket and Lands in the main checkout, outside Codex's workspace.
  const codexDirs = (cwd) => (cwd !== repoRoot ? ['--add-dir', repoRoot] : []);

  return {
    backend,
    harnesses,
    list: () => backend.list(),
    // Grill Sessions only talk, so they run in the main checkout; implement Sessions get a worktree.
    // A Codex Session's id isn't known yet: it comes later, from sessionIdFound (null if it never is).
    async launch({ feature, ticket, prompt, useWorktree = true, harness = 'claude' }) {
      checkHarness(harness);
      const cwd = await cwdFor(feature, ticket, useWorktree);
      const text = prompt(cwd);
      if (harness === 'codex') {
        const since = Date.now();
        await start(feature, ticket, cwd, harness, [...codexDirs(cwd), text]);
        const key = ticketKey(feature.slug, ticket);
        const sessionIdFound = discoverCodexSession({ cwd, since, prompt: text, isAlive: async () => Boolean((await backend.list()).get(key)?.alive) });
        return { sessionId: null, sessionIdFound, cwd, harness };
      }
      const sessionId = crypto.randomUUID();
      await start(feature, ticket, cwd, harness, ['--session-id', sessionId, text]);
      return { sessionId, cwd, harness };
    },
    // Restarts an ended Session, resuming the same conversation in the Harness that started it.
    async relaunch({ feature, ticket, sessionId, useWorktree = true, harness = 'claude' }) {
      checkHarness(harness);
      const cwd = await cwdFor(feature, ticket, useWorktree);
      await start(feature, ticket, cwd, harness, harness === 'codex' ? ['resume', ...codexDirs(cwd), sessionId] : ['--resume', sessionId]);
    },
    // The branch the main checkout has checked out, which an implement Session Lands on. Null when detached.
    async currentBranch() {
      try { return await run('git', ['-C', repoRoot, 'symbolic-ref', '--quiet', '--short', 'HEAD']); } catch { return null; }
    },
    worktreeBranch: async (feature, ticket) => (await worktreeFor(repoRoot, feature.slug, ticket)).branch,
    // After a Ticket has Landed: removes its worktree, then its branch if it's on the main checkout's branch.
    // Both refuse rather than lose anything (a dirty worktree, an unlanded branch).
    async removeWorktree(feature, ticket) {
      const { top, dir, branch } = await worktreeFor(repoRoot, feature.slug, ticket);
      if (fs.existsSync(dir)) await run('git', ['-C', top, 'worktree', 'remove', dir]);
      await run('git', ['-C', top, 'branch', '-d', branch]).catch(() => {});
    },
    async hasWorktree(feature, ticket) {
      try { return fs.existsSync((await worktreeFor(repoRoot, feature.slug, ticket)).dir); } catch { return false; }
    },
    kill: (key) => backend.kill(key),
    open: (key) => backend.open(key),
  };
}

async function isGitRepo(repoRoot) {
  try { return (await run('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel'])) !== ''; } catch { return false; }
}

// A worktree per Ticket, beside the repo: ../<repo>-worktrees/<feature>-<ticket>.
async function worktreeFor(repoRoot, feature, ticket) {
  const top = path.resolve(await run('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel']));
  return { top, dir: path.join(path.dirname(top), `${path.basename(top)}-worktrees`, `${feature}-${ticket.name}`), branch: `sb/${feature}/${ticket.name}` };
}

async function ensureWorktree(repoRoot, feature, ticket) {
  const { top, dir, branch } = await worktreeFor(repoRoot, feature, ticket);
  if (fs.existsSync(dir)) return dir;
  let branchExists = true;
  try { await run('git', ['-C', top, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); } catch { branchExists = false; }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await run('git', ['-C', top, 'worktree', 'add', ...(branchExists ? [dir, branch] : ['-b', branch, dir])]);
  return dir;
}
