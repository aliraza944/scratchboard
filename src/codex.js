// Codex can't be told a session id up front the way `claude --session-id` can, so after a
// Launch Scratchboard finds the id in the rollout file Codex writes for it (ADR 0004).
import fs from 'node:fs';
import path from 'node:path';
import { codexHome } from './platform.js';

const POLL_MS = 2000;
const GIVE_UP_MS = 30 * 60 * 1000;

// The id of the rollout that is this Session's: same cwd, started after the Launch, and
// its first prompt opens with the Launch's first line (which names the Ticket or Map).
// Null when the rollout is someone else's, or hasn't got that far yet.
export function matchRollout(text, { cwd, since, firstLine }) {
  let meta = null;
  for (const line of text.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const p = entry.payload ?? {};
    if (entry.type === 'session_meta') {
      if (path.resolve(p.cwd ?? '') !== path.resolve(cwd) || Date.parse(p.timestamp) < since) return null;
      meta = p;
    } else if (meta && entry.type === 'response_item' && p.type === 'message' && p.role === 'user') {
      // Codex adds its own context as user messages wrapped in <tags>; skip those.
      const prompt = (p.content ?? []).map((c) => c.text ?? '').join('').trim();
      if (prompt.startsWith('<')) continue;
      return prompt.startsWith(firstLine) ? meta.id : null;
    }
  }
  return null;
}

// Day folders that may hold rollouts started since `since`: sessions/YYYY/MM/DD.
// Both the local and the UTC date, since it's not obvious which Codex files under.
function dayDirs(root, since) {
  const dirs = new Set();
  const pad = (n) => String(n).padStart(2, '0');
  for (let t = since - 86400000; t <= Date.now() + 86400000; t += 86400000) {
    const d = new Date(t);
    dirs.add(path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())));
    dirs.add(path.join(root, String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1), pad(d.getUTCDate())));
  }
  return [...dirs];
}

export function scanRollouts({ cwd, since, firstLine, root = path.join(codexHome(), 'sessions') }) {
  for (const dir of dayDirs(root, since)) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs < since) continue;
        const id = matchRollout(fs.readFileSync(file, 'utf8'), { cwd, since, firstLine });
        if (id) return id;
      } catch { /* written to or removed while reading: try again next poll */ }
    }
  }
  return null;
}

// Resolves with the Session's id, or null once it has ended (or after half an hour) without one.
// A Session can sit at Codex's trust prompt before it writes anything, so this keeps looking.
export function discoverCodexSession({ cwd, since, prompt, isAlive }) {
  const firstLine = prompt.split('\n')[0].trim();
  return new Promise((resolve) => {
    const tick = async () => {
      const id = scanRollouts({ cwd, since: since - 5000, firstLine });
      if (id) return resolve(id);
      if (Date.now() - since > GIVE_UP_MS || !(await isAlive().catch(() => false))) return resolve(null);
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  });
}
