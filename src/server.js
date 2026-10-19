// HTTP server: serves the board page, pushes Board snapshots over SSE, and turns
// drags into Launch / Release / Relaunch.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoard } from './tickets.js';
import { claimFile, releaseFile } from './claims.js';
import { listSessions, launchSession, relaunchSession, killSession, openTerminal, notify, ticketKey, tmuxSessionName } from './sessions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, '..', 'public', 'index.html');
// Build Tickets (to-tickets) go through /implement; decision Tickets use their Type's skill.
// Ready -> Grilling runs /grill-me; anything -> In progress runs /implement.
const DEFAULT_PROMPTS = { grill: path.join(here, '..', 'prompt-grill.md'), implement: path.join(here, '..', 'prompt-implement.md') };
const REPO_PROMPTS = { grill: 'scratchboard-prompt-grill.md', implement: 'scratchboard-prompt-implement.md' };
const CLAIMED = ['grilling', 'in-progress'];
const today = () => new Date().toISOString().slice(0, 10);
const SCAN_MS = 1500;
const SESSION_RE = /session ([0-9a-f-]{36})/i;

export function startServer({ repoRoot, port, onListening }) {
  const clients = new Set();
  let snapshot = null;
  let snapshotJson = '';
  let previous = null;
  let busy = new Set(); // ticket keys with an action in flight

  async function scan() {
    const features = readBoard(repoRoot);
    const sessions = await listSessions(repoRoot);
    for (const f of features) {
      for (const t of f.tickets) {
        t.key = ticketKey(f.slug, t);
        const sessionId = t.assignee.match(SESSION_RE)?.[1] ?? null;
        const win = sessions.get(t.key);
        t.sessionId = sessionId;
        if (!CLAIMED.includes(t.column)) t.session = win ? (win.alive ? 'running' : 'ended') : null;
        else if (!sessionId) t.session = win ? (win.alive ? 'running' : 'ended') : 'person';
        else t.session = win?.alive ? 'running' : 'ended';
        t.busy = busy.has(t.key);
      }
    }
    return {
      repo: path.basename(repoRoot),
      repoRoot,
      tmuxSession: tmuxSessionName(repoRoot),
      features: features.map(({ slug, mapTitle, mapPath, tickets }) => ({
        slug, mapTitle, hasMap: Boolean(mapPath),
        tickets: tickets.map(({ key, id, name, title, column, state, statusRaw, assignee, warnings, waitingOn, blockerIds, blocks, session, sessionId, busy, fields, readyForAgent, readyForHuman, needsInfo }) =>
          ({ key, id, name, title, column, state, statusRaw, assignee, warnings, waitingOn, blockerIds, blocks, session, sessionId, busy, readyForAgent, readyForHuman, needsInfo, type: fields.type ?? null })),
      })),
    };
  }

  function announce(prev, next) {
    if (!prev) return;
    const old = new Map(prev.features.flatMap((f) => f.tickets.map((t) => [t.key, t])));
    for (const f of next.features) {
      for (const t of f.tickets) {
        const o = old.get(t.key);
        if (!o) continue;
        const label = `${t.id} ${t.title}`;
        if (t.column === 'resolved' && o.column !== 'resolved') notify('Ticket resolved', label);
        else if (t.column === 'ready' && o.column === 'blocked') notify('Ticket is Ready', label);
        else if (t.column === 'grilling' && t.readyForAgent && !o.readyForAgent) notify('Grilling done', `${label} is ready for agent`);
        if (o.session === 'running' && t.session === 'ended' && t.column !== 'resolved') notify('Session ended', `${label} isn't resolved yet`);
      }
    }
  }

  async function refresh() {
    try {
      const next = await scan();
      const json = JSON.stringify(next);
      if (json === snapshotJson) return;
      announce(previous, next);
      previous = next;
      snapshot = next;
      snapshotJson = json;
      for (const res of clients) res.write(`data: ${json}\n\n`);
    } catch (err) {
      console.error('scan failed:', err.message);
    }
  }

  function findTicket(key) {
    const features = readBoard(repoRoot);
    for (const f of features) for (const t of f.tickets) if (ticketKey(f.slug, t) === key) return { feature: f, ticket: t };
    return null;
  }

  function buildPrompt(feature, ticket, kind) {
    const repoTemplate = path.join(repoRoot, '.scratch', REPO_PROMPTS[kind]);
    const template = fs.readFileSync(fs.existsSync(repoTemplate) ? repoTemplate : DEFAULT_PROMPTS[kind], 'utf8');
    return (cwd) => {
      const inWorktree = cwd !== repoRoot;
      const vars = {
        ticketPath: ticket.path,
        ticketTitle: ticket.title,
        type: ticket.fields.type ?? 'not stated',
        feature: feature.slug,
        mapPath: feature.mapPath ?? '',
        cwd,
        mapStep: feature.mapPath
          ? `Read the Feature's map first: ${feature.mapPath} (its Notes and Decisions so far).`
          : 'This Feature has no map.md. Read the other Tickets in its issues folder for context.',
        mapDoneStep: feature.mapPath
          ? `append one line to the map's "Decisions so far": [<title>](${ticket.relPath}): <one-line gist>.`
          : 'there is no map to update.',
        worktreeStep: inWorktree
          ? `You are in a git worktree (${cwd}) on your own branch, so write code here. Always edit the Ticket and the map at the absolute paths above, in the main checkout, never the worktree's copies.`
          : 'Other Sessions may be working in this same folder on other Tickets. Only touch the files your Ticket needs.',
      };
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
    };
  }

  async function act(key, fn) {
    if (busy.has(key)) throw httpError(409, 'Already working on that Ticket');
    busy.add(key);
    refresh();
    try { return await fn(); } finally { busy.delete(key); refresh(); }
  }

  const actions = {
    // Ready -> Grilling: a /grill-me Session in the main checkout.
    async grill({ key }) {
      const found = findTicket(key);
      if (!found) throw httpError(404, 'No such Ticket');
      const { feature, ticket } = found;
      if (ticket.column !== 'ready') throw httpError(409, `Ticket is ${ticket.column}, not Ready`);
      return act(key, async () => {
        const result = await launchSession({ repoRoot, feature, ticket, prompt: buildPrompt(feature, ticket, 'grill'), useWorktree: false });
        claimFile(ticket.path, `agent (grill session ${result.sessionId}, ${today()})`, 'grilling');
        return { ok: true, ...result };
      });
    },
    // Ready or Grilling -> In progress: a fresh /implement Session. Ends the grill Session first.
    async launch({ key }) {
      const found = findTicket(key);
      if (!found) throw httpError(404, 'No such Ticket');
      const { feature, ticket } = found;
      if (!['ready', 'grilling'].includes(ticket.column)) throw httpError(409, `Ticket is ${ticket.column}, not Ready or Grilling`);
      return act(key, async () => {
        if (ticket.column === 'grilling') await killSession((await listSessions(repoRoot)).get(key));
        const result = await launchSession({ repoRoot, feature, ticket, prompt: buildPrompt(feature, ticket, 'implement') });
        claimFile(ticket.path, `agent (session ${result.sessionId}, ${today()})`, 'in-progress');
        return { ok: true, ...result };
      });
    },
    async release({ key }) {
      const found = findTicket(key);
      if (!found) throw httpError(404, 'No such Ticket');
      if (!CLAIMED.includes(found.ticket.column)) throw httpError(409, 'Ticket is not Grilling or In progress');
      return act(key, async () => {
        await killSession((await listSessions(repoRoot)).get(key));
        releaseFile(found.ticket.path);
        return { ok: true };
      });
    },
    async relaunch({ key }) {
      const found = findTicket(key);
      if (!found) throw httpError(404, 'No such Ticket');
      const sessionId = found.ticket.assignee.match(SESSION_RE)?.[1];
      if (!sessionId) throw httpError(409, 'This Ticket was not claimed by a Session');
      return act(key, async () => {
        const existing = (await listSessions(repoRoot)).get(key);
        if (existing?.alive) throw httpError(409, 'Session is still running');
        const useWorktree = found.ticket.column !== 'grilling';
        await relaunchSession({ repoRoot, feature: found.feature, ticket: found.ticket, existing, sessionId, useWorktree });
        return { ok: true };
      });
    },
    async open({ key }) {
      const existing = (await listSessions(repoRoot)).get(key);
      if (!existing) throw httpError(404, 'No tmux window for this Ticket');
      await openTerminal(repoRoot, existing);
      return { ok: true };
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Only answer to our own page: blocks DNS rebinding and cross-site POSTs.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'Bad host' });

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(fs.readFileSync(PAGE));
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        clients.add(res);
        if (snapshotJson) res.write(`data: ${snapshotJson}\n\n`);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/ticket') {
        const found = findTicket(url.searchParams.get('key') ?? '');
        if (!found) return send(res, 404, { error: 'No such Ticket' });
        return send(res, 200, { markdown: fs.readFileSync(found.ticket.path, 'utf8'), path: found.ticket.path });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers['x-scratchboard'] !== '1') return send(res, 403, { error: 'Missing header' });
        const action = actions[url.pathname.slice(5)];
        if (!action) return send(res, 404, { error: 'Unknown action' });
        const body = JSON.parse((await readBody(req)) || '{}');
        return send(res, 200, await action(body));
      }
      send(res, 404, { error: 'Not found' });
    } catch (err) {
      send(res, err.status ?? 500, { error: err.message });
    }
  });

  setInterval(refresh, SCAN_MS);
  try {
    fs.watch(path.join(repoRoot, '.scratch'), { recursive: true }, () => refresh());
  } catch { /* polling covers it */ }

  refresh().then(() => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < 4760) server.listen(++port, '127.0.0.1');
      else throw err;
    });
    server.listen(port, '127.0.0.1', () => onListening?.(`http://localhost:${port}`));
  });
  return server;
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
