// Reads a repo's .scratch folder into Features and Tickets, and works out each
// Ticket's column. Vocabulary follows GLOSSARY.md.
import fs from 'node:fs';
import path from 'node:path';

// Status words from wayfinder, to-tickets and the triage roles (setup-matt-pocock-skills).
const OPEN = ['open', 'ready-for-agent', 'ready for agent', 'ready-for-human', 'ready for human', 'ready', 'needs-triage', 'needs triage', 'todo'];
const NEEDS_INFO = ['needs-info', 'needs info'];
const GRILLING = ['grilling', 'in grilling'];
const IN_PROGRESS = ['in-progress', 'in progress', 'claimed', 'wip', 'doing'];
const RESOLVED = ['resolved', 'closed', 'done', 'completed', 'complete', 'wontfix', 'out of scope', 'out-of-scope', 'not needed', 'skipped'];

const HEADER_KEYS = { type: 'type', status: 'status', assignee: 'assignee', 'blocked by': 'blockedBy', labels: 'labels' };

// `Key: value` or `**Key:** value` (to-tickets writes the bold form).
const HEADER_RE = /^\s*(?:\*\*)?([A-Za-z][A-Za-z ]*?)(?::\*\*|\*\*:|:)\s*(.*)$/;

export function normalizeStatus(raw) {
  if (raw == null || raw.trim() === '') return { state: 'open', known: false };
  const v = raw.trim().toLowerCase().replace(/[`*_]/g, '');
  const match = (list) => list.some((w) => v === w || v.startsWith(w + ' ') || v.startsWith(w + ' (') || v.startsWith(w + ','));
  if (match(RESOLVED)) return { state: 'resolved', known: true };
  if (match(NEEDS_INFO)) return { state: 'needs-info', known: true };
  if (match(GRILLING)) return { state: 'grilling', known: true };
  if (match(IN_PROGRESS)) return { state: 'in-progress', known: true };
  if (match(OPEN)) return { state: 'open', known: true };
  return { state: 'unknown', known: false };
}

// Pulls the header fields out of a Ticket's markdown. Header lines sit above the
// first `## ` heading; a `## Blocked by` section (issue template) also counts.
export function parseTicketText(text) {
  const lines = text.split(/\r?\n/);
  const fields = {};
  let title = '';
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    if (!title && line.startsWith('# ')) { title = line.slice(2).trim(); continue; }
    const m = line.match(HEADER_RE);
    if (!m) continue;
    const key = HEADER_KEYS[m[1].trim().toLowerCase()];
    if (key && !(key in fields)) fields[key] = m[2].trim();
  }
  if (!('blockedBy' in fields)) {
    const start = lines.findIndex((l) => /^##\s+blocked by\s*$/i.test(l));
    if (start >= 0) {
      const items = [];
      for (let j = start + 1; j < lines.length && !lines[j].startsWith('#'); j++) {
        const b = lines[j].match(/^\s*[-*]\s+(.*)$/);
        if (b) items.push(b[1].trim());
      }
      fields.blockedBy = items.join(', ');
    }
  }
  return { title, fields };
}

// Turns a Blocked-by value into Ticket numbers within the same Feature.
// Returns { ids, unparsed } so anything that can't be read is flagged, not guessed.
export function parseBlockedBy(raw, ticketsByTitle = new Map()) {
  if (raw == null) return { ids: [], unparsed: [] };
  const v = raw.trim();
  if (v === '' || /^(none|n\/a|-|—)\b/i.test(v)) return { ids: [], unparsed: [] };
  const ids = [];
  const unparsed = [];
  const parts = splitOutsideBrackets(v);
  for (const part of parts) {
    const p = part.trim().replace(/\.$/, '');
    if (!p) continue;
    const link = p.match(/\]\(([^)]*?)(\d{1,4})-[^)]*\.md\)/);
    const num = p.match(/^#?(\d{1,4})\b/);
    if (link) ids.push(pad(link[2]));
    else if (num) ids.push(pad(num[1]));
    else {
      const byTitle = ticketsByTitle.get(stripLink(p).toLowerCase());
      if (byTitle) ids.push(byTitle);
      else unparsed.push(p);
    }
  }
  return { ids: [...new Set(ids)], unparsed };
}

function splitOutsideBrackets(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.flatMap((x) => (/\[/.test(x) ? [x] : x.split(/\s+and\s+/i)));
}

const stripLink = (s) => s.replace(/^\[(.*)\]\(.*\)$/, '$1').replace(/^\d{1,4}:\s*/, '').trim();
const pad = (n) => String(Number(n)).padStart(2, '0');

// Reads every `.scratch/<feature>/issues/*.md` under repoRoot. A Feature with a Map
// but no Tickets yet still counts: a chart Session can turn it into Tickets.
export function readBoard(repoRoot) {
  const scratch = path.join(repoRoot, '.scratch');
  const features = [];
  let entries = [];
  try { entries = fs.readdirSync(scratch, { withFileTypes: true }); } catch { /* no .scratch */ }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(scratch, e.name);
    const feature = readFeature(e.name, dir, path.join(dir, 'issues'));
    if (feature.tickets.length || feature.mapPath) features.push(feature);
  }
  features.sort((a, b) => a.slug.localeCompare(b.slug));
  return features;
}

// The usual place is `<feature>/issues/NN-slug.md`. Skills that "publish to the issue
// tracker" (triage, to-spec) may also write straight into `<feature>/`.
const NOT_TICKETS = new Set(['map.md', 'spec.md', 'readme.md', 'glossary.md']);
function ticketFiles(dir, issuesDir) {
  const md = (d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(d, f)); } catch { return []; } };
  return [...md(issuesDir), ...md(dir).filter((f) => !NOT_TICKETS.has(path.basename(f).toLowerCase()))];
}

function readFeature(slug, dir, issuesDir) {
  const mapPath = path.join(dir, 'map.md');
  let mapTitle = null;
  let hasFog = false;
  const hasMap = fs.existsSync(mapPath);
  if (hasMap) {
    const text = fs.readFileSync(mapPath, 'utf8');
    const first = text.split(/\r?\n/).find((l) => l.startsWith('# '));
    if (first) mapTitle = first.slice(2).replace(/^Map:\s*/i, '').trim();
    hasFog = mapHasFog(text);
  }
  const raw = [];
  for (const filePath of ticketFiles(dir, issuesDir)) {
    const file = path.basename(filePath);
    const m = file.match(/^(\d{1,4})-(.*)\.md$/);
    const text = fs.readFileSync(filePath, 'utf8');
    const { title, fields } = parseTicketText(text);
    // Loose files beside map.md only count when they carry a Status line, like every issue does.
    if (path.dirname(filePath) === dir && !('status' in fields)) continue;
    raw.push({
      id: m ? pad(m[1]) : file.replace(/\.md$/, ''),
      file,
      name: file.replace(/\.md$/, ''),
      path: filePath,
      relPath: path.relative(dir, filePath),
      title: title.replace(/^\d{1,4}:\s*/, '') || file,
      fields,
      boldHeaders: /^\s*\*\*status:\*\*/im.test(text),
      numbered: Boolean(m),
    });
  }
  const byTitle = new Map(raw.map((t) => [t.title.toLowerCase(), t.id]));
  const byId = new Map(raw.map((t) => [t.id, t]));
  const tickets = raw.map((t) => {
    const status = normalizeStatus(t.fields.status);
    const blockers = parseBlockedBy(t.fields.blockedBy, byTitle);
    // wayfinder gives each Decision Ticket a Type line; to-tickets' Build Tickets have none.
    const kind = t.fields.type ? 'decision' : 'build';
    return { ...t, kind, statusRaw: t.fields.status ?? null, state: status.state, statusKnown: status.known, blockerIds: blockers.ids, blockersUnparsed: blockers.unparsed };
  });
  for (const t of tickets) Object.assign(t, deriveColumn(t, byId, tickets));
  const blocks = new Map();
  for (const t of tickets) for (const b of t.blockerIds) (blocks.get(b) ?? blocks.set(b, []).get(b)).push(t.id);
  for (const t of tickets) t.blocks = blocks.get(t.id) ?? [];
  return { slug, dir, mapPath: hasMap ? mapPath : null, mapTitle, hasFog, mapAction: hasMap ? mapAction(tickets, hasFog) : null, tickets };
}

// Which Map Session the lane offers first: chart while there's nothing or Fog left to
// ticket, slice once every decision is made and nothing has been sliced yet.
function mapAction(tickets, hasFog) {
  if (!tickets.length || hasFog) return 'chart';
  const decisions = tickets.filter((t) => t.kind === 'decision');
  const decided = decisions.length && decisions.every((t) => t.state === 'resolved');
  return decided && decisions.length === tickets.length ? 'slice' : null;
}

// Fog is whatever the Map's "Not yet specified" section holds besides comments and blank lines.
function mapHasFog(text) {
  const m = text.match(/^#{2,3}\s+not yet specified\b.*$([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im);
  return Boolean(m && m[1].replace(/<!--[\s\S]*?-->/g, '').trim());
}

function deriveColumn(t, byId, tickets) {
  const warnings = [];
  if (t.fields.status == null) warnings.push('No Status line');
  else if (!t.statusKnown) warnings.push(`Unknown Status "${t.fields.status}"`);
  for (const u of t.blockersUnparsed) warnings.push(`Can't read Blocked by "${u}"`);
  const resolved = (id) => tickets.find((x) => x.id === id)?.state === 'resolved';
  const missing = t.blockerIds.filter((id) => !byId.has(id));
  for (const id of missing) warnings.push(`Blocker ${id} not found in this Feature`);
  const waitingOn = t.blockerIds.filter((id) => !resolved(id));
  const assignee = t.fields.assignee?.trim() || '';
  // ready-for-agent is the skills' marker for "grilling is done, an agent can build it".
  const readyForAgent = /^ready[- ]for[- ]agent\b/i.test(t.fields.status?.replace(/[`*_]/g, '').trim() ?? '');
  // A grill Session's claim keeps the Ticket in Grilling until you drag it on.
  const grillClaim = /\bgrill session\b/i.test(assignee);
  let column;
  if (t.state === 'resolved') column = 'resolved';
  else if (t.state === 'grilling' || (t.state === 'open' && grillClaim)) column = 'grilling';
  else if (t.state === 'in-progress' || (t.state === 'open' && assignee)) column = 'in-progress';
  else if (t.state === 'unknown' || t.state === 'needs-info' || t.blockersUnparsed.length) column = 'blocked';
  else column = waitingOn.length ? 'blocked' : 'ready';
  const readyForHuman = /^ready[- ]for[- ]human\b/i.test(t.fields.status?.replace(/[`*_]/g, '').trim() ?? '');
  return { column, waitingOn, warnings, assignee, readyForAgent, readyForHuman, needsInfo: t.state === 'needs-info' };
}

// The number a new Ticket in this Feature gets: one past the highest numbered Ticket.
export function nextTicketNumber(feature) {
  const nums = feature.tickets.filter((t) => t.numbered).map((t) => Number(t.id));
  return pad(Math.max(0, ...nums) + 1);
}
