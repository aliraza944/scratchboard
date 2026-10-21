// HTTP server: serves the board page, pushes Board snapshots over SSE, turns drags
// into Launch / Release / Relaunch, and (pty backend) streams Sessions over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimFile, releaseFile } from './claims.js';
import { readBoard, nextTicketNumber } from './tickets.js';
import { renderPrompt } from './prompts.js';
import { createSessions, ticketKey, mapTarget, mapKey } from './sessions.js';
import { notify as nativeNotify, nativeNotifications } from './platform.js';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, '..', 'public', 'index.html');
// Browser libraries served from node_modules, so the board works offline.
const NODE_MODULES = path.join(here, '..', 'node_modules');
const VENDOR = {
  'xterm.js': ['@xterm/xterm/lib/xterm.js', 'text/javascript'],
  'xterm.css': ['@xterm/xterm/css/xterm.css', 'text/css'],
  'addon-fit.js': ['@xterm/addon-fit/lib/addon-fit.js', 'text/javascript'],
  'marked.js': ['marked/lib/marked.umd.js', 'text/javascript'],
  'purify.js': ['dompurify/dist/purify.min.js', 'text/javascript'],
};
const CLAIMED = ['grilling', 'in-progress'];
const today = () => new Date().toISOString().slice(0, 10);
const SCAN_MS = 1500;
const SESSION_RE = /session ([0-9a-f-]{36})/i;

export async function startServer({ repoRoot, port, backend: requestedBackend = 'auto', onListening }) {
  const sessions = await createSessions(repoRoot, requestedBackend);
  const clients = new Set();
  let snapshot = null;
  let snapshotJson = '';
  let previous = null;
  let busy = new Set(); // ticket keys with an action in flight
  // Map Sessions claim nothing in a file, so their kind and id live here only, for
  // Relaunch and the end-of-Session notice. They're gone when the board stops.
  const mapSessions = new Map(); // slug -> { kind, sessionId, ticketsAtLaunch: Set of Ticket names }

  async function scan() {
    const features = readBoard(repoRoot);
    const live = await sessions.list();
    for (const f of features) {
      for (const t of f.tickets) {
        t.key = ticketKey(f.slug, t);
        const sessionId = t.assignee.match(SESSION_RE)?.[1] ?? null;
        const win = live.get(t.key);
        t.sessionId = sessionId;
        if (!CLAIMED.includes(t.column)) t.session = win ? (win.alive ? 'running' : 'ended') : null;
        else if (!sessionId) t.session = win ? (win.alive ? 'running' : 'ended') : 'person';
        else t.session = win?.alive ? 'running' : 'ended';
        t.busy = busy.has(t.key);
      }
      f.mapKey = mapKey(f.slug);
      const win = live.get(f.mapKey);
      const known = mapSessions.get(f.slug);
      f.mapSession = f.mapPath && win
        ? { status: win.alive ? 'running' : 'ended', kind: known?.kind ?? null, canRelaunch: Boolean(known) }
        : null;
      f.mapBusy = busy.has(f.mapKey);
    }
    return {
      repo: path.basename(repoRoot),
      repoRoot,
      backend: { name: sessions.backend.name, label: sessions.backend.label, inBrowser: Boolean(sessions.backend.inBrowser) },
      nativeNotifications,
      features: features.map(({ slug, mapTitle, mapPath, hasFog, mapAction, mapKey, mapSession, mapBusy, tickets }) => ({
        slug, mapTitle, hasMap: Boolean(mapPath), hasFog, mapAction, mapKey, mapSession, mapBusy,
        tickets: tickets.map(({ key, id, name, title, kind, column, state, statusRaw, assignee, warnings, waitingOn, blockerIds, blocks, session, sessionId, busy, fields, readyForAgent, readyForHuman, needsInfo }) =>
          ({ key, id, name, title, kind, column, state, statusRaw, assignee, warnings, waitingOn, blockerIds, blocks, session, sessionId, busy, readyForAgent, readyForHuman, needsInfo, type: fields.type ?? null })),
      })),
    };
  }

  // Desktop notification where the OS has a CLI for it; otherwise the page shows one.
  function notify(title, body) {
    if (nativeNotifications) return nativeNotify(title, body);
    const msg = `event: notify\ndata: ${JSON.stringify({ title, body })}\n\n`;
    for (const res of clients) res.write(msg);
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
      // New Tickets bring their own notices; a Map Session that wrote none is worth one.
      const was = prev.features.find((x) => x.slug === f.slug)?.mapSession?.status;
      const known = mapSessions.get(f.slug);
      if (was === 'running' && f.mapSession?.status === 'ended' && known && f.tickets.every((t) => known.ticketsAtLaunch.has(t.name))) {
        notify('Map Session ended', `The ${known.kind} Session on ${f.mapTitle ?? f.slug} wrote no new Tickets`);
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

  // Only Features with a Map: those are the ones a chart or slice Session can work on.
  function findFeature(slug) {
    return readBoard(repoRoot).find((f) => f.slug === slug && f.mapPath) ?? null;
  }
  function findMap(key) {
    return readBoard(repoRoot).find((f) => f.mapPath && mapKey(f.slug) === key) ?? null;
  }

  function buildMapPrompt(feature, kind) {
    const vars = {
      mapPath: feature.mapPath,
      mapTitle: feature.mapTitle ?? feature.slug,
      feature: feature.slug,
      issuesDir: path.join(feature.dir, 'issues'),
      nextNumber: nextTicketNumber(feature),
    };
    return (cwd) => renderPrompt(repoRoot, kind, { ...vars, cwd });
  }

  function buildPrompt(feature, ticket, kind) {
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
      return renderPrompt(repoRoot, kind, vars);
    };
  }

  async function act(key, fn) {
    if (busy.has(key)) throw httpError(409, 'Already working on that Ticket or Map');
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
        const result = await sessions.launch({ feature, ticket, prompt: buildPrompt(feature, ticket, 'grill'), useWorktree: false });
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
        if (ticket.column === 'grilling') await sessions.kill(key);
        const result = await sessions.launch({ feature, ticket, prompt: buildPrompt(feature, ticket, 'implement') });
        claimFile(ticket.path, `agent (session ${result.sessionId}, ${today()})`, 'in-progress');
        return { ok: true, ...result };
      });
    },
    async release({ key }) {
      const found = findTicket(key);
      if (!found) throw httpError(404, 'No such Ticket');
      if (!CLAIMED.includes(found.ticket.column)) throw httpError(409, 'Ticket is not Grilling or In progress');
      return act(key, async () => {
        await sessions.kill(key);
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
        if ((await sessions.list()).get(key)?.alive) throw httpError(409, 'Session is still running');
        const useWorktree = found.ticket.column !== 'grilling';
        await sessions.relaunch({ feature: found.feature, ticket: found.ticket, sessionId, useWorktree });
        return { ok: true };
      });
    },
    // A chart (/wayfinder) or slice (/to-tickets) Session on a Map, in the main checkout.
    // Nothing is claimed in map.md: while the Session runs, no other one can be Launched on the Map.
    async chart({ slug }) { return launchMap(slug, 'chart'); },
    async slice({ slug }) { return launchMap(slug, 'slice'); },
    async relaunchMap({ slug }) {
      const feature = findFeature(slug);
      if (!feature) throw httpError(404, 'No such Map');
      const known = mapSessions.get(slug);
      if (!known) throw httpError(409, 'No Session to relaunch on this Map (it was closed, or the board restarted). Start a new one instead');
      const key = mapKey(slug);
      return act(key, async () => {
        if ((await sessions.list()).get(key)?.alive) throw httpError(409, 'Session is still running');
        await sessions.relaunch({ feature, ticket: mapTarget(slug), sessionId: known.sessionId, useWorktree: false });
        return { ok: true };
      });
    },
    async stopMap({ slug }) {
      const key = mapKey(slug);
      return act(key, async () => {
        await sessions.kill(key);
        mapSessions.delete(slug);
        return { ok: true };
      });
    },
    async open({ key }) {
      try { return { ok: true, ...(await sessions.open(key)) }; }
      catch (err) { throw httpError(404, err.message); }
    },
  };

  async function launchMap(slug, kind) {
    const feature = findFeature(slug);
    if (!feature) throw httpError(404, 'No such Map');
    const key = mapKey(slug);
    return act(key, async () => {
      if ((await sessions.list()).get(key)?.alive) throw httpError(409, 'A Session is already running on this Map');
      const result = await sessions.launch({ feature, ticket: mapTarget(slug), prompt: buildMapPrompt(feature, kind), useWorktree: false });
      mapSessions.set(slug, { kind, sessionId: result.sessionId, ticketsAtLaunch: new Set(feature.tickets.map((t) => t.name)) });
      return { ok: true, ...result };
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Only answer to our own page: blocks DNS rebinding and cross-site POSTs.
    if (!localHost(req)) return send(res, 403, { error: 'Bad host' });

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(fs.readFileSync(PAGE));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/vendor/')) {
        const v = VENDOR[url.pathname.slice(8)];
        if (!v) return send(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'content-type': v[1], 'cache-control': 'max-age=3600' });
        return res.end(fs.readFileSync(path.join(NODE_MODULES, v[0])));
      }
      if (req.method === 'GET' && url.pathname === '/api/ping') {
        return send(res, 200, { app: 'scratchboard', repoRoot, backend: sessions.backend.name, pid: process.pid });
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
        const key = url.searchParams.get('key') ?? '';
        const map = findMap(key);
        if (map) return send(res, 200, { markdown: fs.readFileSync(map.mapPath, 'utf8'), path: map.mapPath });
        const found = findTicket(key);
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

  // Browser terminals for the pty backend. A terminal is a shell on this machine, so
  // only our own page (same host and port) may connect.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin ?? '';
    const sameOrigin = ['localhost', '127.0.0.1', '[::1]'].some((h) => origin === `http://${h}:${listeningPort}`);
    if (url.pathname !== '/api/term' || !localHost(req) || !sameOrigin || !sessions.backend.attach) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => sessions.backend.attach(url.searchParams.get('key') ?? '', ws));
  });

  setInterval(refresh, SCAN_MS);
  try {
    fs.watch(path.join(repoRoot, '.scratch'), { recursive: true }, () => refresh());
  } catch { /* polling covers it */ }

  let listeningPort = port;
  await refresh();
  await new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && listeningPort < port + 20) server.listen(++listeningPort, '127.0.0.1');
      else reject(err);
    });
    server.listen(listeningPort, '127.0.0.1', resolve);
  });
  onListening?.({ url: `http://localhost:${listeningPort}`, port: listeningPort, backend: sessions.backend });
  return { server, stop: () => { sessions.backend.stopAll?.(); server.close(); } };
}

function localHost(req) {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '[::1]'].includes(host);
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
