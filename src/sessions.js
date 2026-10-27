// Starts, finds and ends Sessions. The terminal side is a backend: tmux whenever
// it's installed, otherwise Scratchboard's own pty terminal (see src/backends/).
// This layer adds what every backend shares: worktrees and the `claude` command.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run, commandExists, claudeCommand } from './platform.js';
import { createTmuxBackend } from './backends/tmux.js';

export const ticketKey = (feature, ticket) => `${feature}/${ticket.name}`;
// A Map's chart or slice Session runs under the Feature's `<slug>/map` key. Ticket names
// start with their number, so it can't clash with a Ticket's key.
// mapTarget is what launch/relaunch take in place of a Ticket for it.
export const mapTarget = (slug) => ({ name: 'map', windowName: `${slug}-map` });
export const mapKey = (slug) => ticketKey(slug, mapTarget(slug));
export const BACKENDS = ['tmux', 'pty'];

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

  async function startClaude(feature, ticket, cwd, claudeArgs) {
    const claude = await claudeCommand();
    await backend.start({ key: ticketKey(feature.slug, ticket), name: ticket.windowName ?? ticket.name, cwd, command: claude.command, args: [...claude.args, ...claudeArgs] });
  }

  return {
    backend,
    list: () => backend.list(),
    // Grill Sessions only talk, so they run in the main checkout; implement Sessions get a worktree.
    async launch({ feature, ticket, prompt, useWorktree = true }) {
      const cwd = await cwdFor(feature, ticket, useWorktree);
      const sessionId = crypto.randomUUID();
      await startClaude(feature, ticket, cwd, ['--session-id', sessionId, prompt(cwd)]);
      return { sessionId, cwd };
    },
    // Restarts an ended Session, resuming the same conversation.
    async relaunch({ feature, ticket, sessionId, useWorktree = true }) {
      const cwd = await cwdFor(feature, ticket, useWorktree);
      await startClaude(feature, ticket, cwd, ['--resume', sessionId]);
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
