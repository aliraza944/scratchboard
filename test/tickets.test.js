import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeStatus, parseTicketText, parseBlockedBy, readBoard, nextTicketNumber } from '../src/tickets.js';
import { claimText, releaseText } from '../src/claims.js';

test('normalizeStatus maps the words different skills use', () => {
  assert.equal(normalizeStatus('open').state, 'open');
  assert.equal(normalizeStatus('ready-for-agent').state, 'open');
  assert.equal(normalizeStatus('In progress').state, 'in-progress');
  assert.equal(normalizeStatus('resolved (2026-10-14)').state, 'resolved');
  assert.equal(normalizeStatus('closed').state, 'resolved');
  assert.deepEqual(normalizeStatus('pondering'), { state: 'unknown', known: false });
  assert.equal(normalizeStatus(undefined).known, false);
});

test('parseTicketText reads plain and bold header lines', () => {
  const plain = parseTicketText('# Title\n\nType: grilling\nStatus: open\nBlocked by: 07, 08\n\n## Question\nStatus: ignored\n');
  assert.equal(plain.title, 'Title');
  assert.deepEqual(plain.fields, { type: 'grilling', status: 'open', blockedBy: '07, 08' });

  const bold = parseTicketText('# 03: Build it\n\n**What to build:** x\n\n**Blocked by:** None (can start immediately)\n\n**Status:** ready-for-agent\n');
  assert.equal(bold.fields.status, 'ready-for-agent');
  assert.equal(bold.fields.blockedBy, 'None (can start immediately)');
});

test('parseTicketText falls back to a ## Blocked by section', () => {
  const t = parseTicketText('# T\n\n## What to build\nx\n\n## Blocked by\n\n- 02\n- 05\n');
  assert.equal(t.fields.blockedBy, '02, 05');
});

test('parseBlockedBy reads numbers, links and titles, and flags the rest', () => {
  assert.deepEqual(parseBlockedBy(''), { ids: [], unparsed: [] });
  assert.deepEqual(parseBlockedBy('None (can start immediately)').ids, []);
  assert.deepEqual(parseBlockedBy('7, #08 and 13').ids, ['07', '08', '13']);
  assert.deepEqual(parseBlockedBy('[Order lifecycle, states](08-order-lifecycle.md)').ids, ['08']);
  const titles = new Map([['set up the db', '04']]);
  assert.deepEqual(parseBlockedBy('Set up the DB; something vague', titles), { ids: ['04'], unparsed: ['something vague'] });
});

test('readBoard derives columns from status, claims and blockers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const issues = path.join(root, '.scratch', 'feat', 'issues');
  fs.mkdirSync(issues, { recursive: true });
  fs.writeFileSync(path.join(root, '.scratch', 'feat', 'map.md'), '# Map: My feature\n');
  const write = (f, body) => fs.writeFileSync(path.join(issues, f), body);
  write('01-a.md', '# A\n\nStatus: resolved\nAssignee: founder\nBlocked by:\n');
  write('02-b.md', '# B\n\nStatus: open\nBlocked by: 01\n');
  write('03-c.md', '# C\n\nStatus: open\nBlocked by: 02\n');
  write('04-d.md', '# D\n\nStatus: open\nAssignee: founder\nBlocked by:\n');
  write('05-e.md', '# E\n\nStatus: maybe\nBlocked by:\n');
  const [feat] = readBoard(root);
  assert.equal(feat.mapTitle, 'My feature');
  const col = Object.fromEntries(feat.tickets.map((t) => [t.id, t.column]));
  assert.deepEqual(col, { '01': 'resolved', '02': 'ready', '03': 'blocked', '04': 'in-progress', '05': 'blocked' });
  const c = feat.tickets.find((t) => t.id === '03');
  assert.deepEqual(c.waitingOn, ['02']);
  assert.deepEqual(feat.tickets.find((t) => t.id === '02').blocks, ['03']);
  assert.match(feat.tickets.find((t) => t.id === '05').warnings[0], /Unknown Status/);
});

test('claim and release rewrite only Status and Assignee', () => {
  const plain = '# T\n\nType: research\nStatus: open\nAssignee: someone\nBlocked by: 01\n\n## Question\n';
  const claimed = claimText(plain, 'agent (session abc, 2026-10-19)');
  assert.equal(claimed, '# T\n\nType: research\nStatus: in-progress\nAssignee: agent (session abc, 2026-10-19)\nBlocked by: 01\n\n## Question\n');
  assert.equal(releaseText(claimed), '# T\n\nType: research\nStatus: open\nBlocked by: 01\n\n## Question\n');

  const bold = '# 01: X\n\n**Blocked by:** None\n\n**Status:** ready-for-agent\n\n- [ ] a\n';
  const boldClaimed = claimText(bold, 'agent');
  assert.match(boldClaimed, /\*\*Status:\*\* in-progress\n\*\*Assignee:\*\* agent\n/);
  assert.equal(releaseText(boldClaimed), bold);
});

test('Grilling: grill claims stay in Grilling, ready-for-agent marks it done', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const issues = path.join(root, '.scratch', 'feat', 'issues');
  fs.mkdirSync(issues, { recursive: true });
  const write = (f, body) => fs.writeFileSync(path.join(issues, f), body);
  write('01-a.md', '# A\n\nStatus: grilling\nAssignee: agent (grill session x, 2026-10-19)\n');
  write('02-b.md', '# B\n\nStatus: ready-for-agent\nAssignee: agent (grill session y, 2026-10-19)\n');
  write('03-c.md', '# C\n\nStatus: ready-for-agent\n');
  const [feat] = readBoard(root);
  const t = Object.fromEntries(feat.tickets.map((x) => [x.id, x]));
  assert.equal(t['01'].column, 'grilling');
  assert.equal(t['01'].readyForAgent, false);
  assert.equal(t['02'].column, 'grilling');
  assert.equal(t['02'].readyForAgent, true);
  assert.equal(t['03'].column, 'ready');
  assert.equal(t['03'].readyForAgent, true);
});

test('claim with a status, and release keeps ready-for-agent', () => {
  const plain = '# T\n\nStatus: open\n';
  const grilling = claimText(plain, 'agent (grill session x, d)', 'grilling');
  assert.equal(grilling, '# T\n\nStatus: grilling\nAssignee: agent (grill session x, d)\n');
  assert.equal(releaseText(grilling), plain);
  const grilled = grilling.replace('Status: grilling', 'Status: ready-for-agent');
  assert.equal(releaseText(grilled), '# T\n\nStatus: ready-for-agent\n');
});

test('reads loose ticket files beside map.md, and triage status words', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const feat = path.join(root, '.scratch', 'feat');
  fs.mkdirSync(feat, { recursive: true });
  fs.mkdirSync(path.join(root, '.scratch', 'empty'));
  fs.writeFileSync(path.join(feat, 'map.md'), '# Map: F\n\nStatus: open\n');
  fs.writeFileSync(path.join(feat, 'spec.md'), '# Spec\n\nStatus: open\n');
  fs.writeFileSync(path.join(feat, 'notes.md'), '# Just notes\n');
  fs.writeFileSync(path.join(feat, 'login-bug.md'), '# Login bug\n\nStatus: needs-info\n');
  fs.writeFileSync(path.join(feat, 'dark-mode.md'), '# Dark mode\n\nStatus: ready-for-human\n');
  const board = readBoard(root);
  assert.deepEqual(board.map((f) => f.slug), ['feat']);
  const t = Object.fromEntries(board[0].tickets.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(t).sort(), ['dark-mode', 'login-bug']);
  assert.equal(t['login-bug'].column, 'blocked');
  assert.equal(t['login-bug'].needsInfo, true);
  assert.equal(t['dark-mode'].column, 'ready');
  assert.equal(t['dark-mode'].readyForHuman, true);
  assert.equal(t['dark-mode'].relPath, 'dark-mode.md');
});

const scratchTree = (features) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  for (const [slug, files] of Object.entries(features)) {
    const dir = path.join(root, '.scratch', slug);
    fs.mkdirSync(path.join(dir, 'issues'), { recursive: true });
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
  }
  return root;
};

test('a Feature with only a Map is on the board, an empty folder is not', () => {
  const root = scratchTree({ charted: { 'map.md': '# Map: Charted\n\n## Destination\nx\n' }, empty: {} });
  const board = readBoard(root);
  assert.deepEqual(board.map((f) => f.slug), ['charted']);
  assert.equal(board[0].mapTitle, 'Charted');
  assert.deepEqual(board[0].tickets, []);
});

test('Fog is what the Map lists under Not yet specified, ignoring comments and blank lines', () => {
  const map = (fog) => `# Map: M\n\n## Destination\nx\n\n## Not yet specified\n${fog}\n## Out of scope\n- far away\n`;
  const root = scratchTree({
    foggy: { 'map.md': map('\n<!-- see Fog of war -->\n- how billing works\n') },
    clear: { 'map.md': map('\n<!-- see "Fog of war": in-scope fog\n     you cannot ticket yet -->\n\n') },
    titled: { 'map.md': '# Map: T\n\n### Not yet specified (Fog)\n- refunds\n' },
    nosection: { 'map.md': '# Map: N\n\n## Destination\nx\n' },
  });
  const fog = Object.fromEntries(readBoard(root).map((f) => [f.slug, f.hasFog]));
  assert.deepEqual(fog, { clear: false, foggy: true, nosection: false, titled: true });
});

test('Decision Tickets carry a Type line, Build Tickets do not', () => {
  const root = scratchTree({ f: { 'map.md': '# Map: F\n' } });
  const issues = path.join(root, '.scratch', 'f', 'issues');
  fs.writeFileSync(path.join(issues, '01-q.md'), '# Q\n\nType: grilling\nStatus: resolved\n');
  fs.writeFileSync(path.join(issues, '02-b.md'), '# 02: B\n\n**What to build:** x\n\n**Status:** ready-for-agent\n');
  const kinds = Object.fromEntries(readBoard(root)[0].tickets.map((t) => [t.id, t.kind]));
  assert.deepEqual(kinds, { '01': 'decision', '02': 'build' });
});

test('the main Map action is chart, slice or none, from the Map state', () => {
  const fog = '# Map: M\n\n## Not yet specified\n- later\n';
  const clear = '# Map: M\n\n## Not yet specified\n<!-- none -->\n';
  const decision = (status) => `# D\n\nType: research\nStatus: ${status}\n`;
  const build = '# 03: B\n\n**Status:** ready-for-agent\n';
  const root = scratchTree({
    bare: { 'map.md': clear },
    foggy: { 'map.md': fog, 'issues/01-d.md': decision('resolved') },
    open: { 'map.md': clear, 'issues/01-d.md': decision('resolved'), 'issues/02-d.md': decision('open') },
    decided: { 'map.md': clear, 'issues/01-d.md': decision('resolved'), 'issues/02-d.md': decision('closed') },
    sliced: { 'map.md': clear, 'issues/01-d.md': decision('resolved'), 'issues/03-b.md': build },
    nomap: { 'issues/01-d.md': decision('open') },
  });
  const action = Object.fromEntries(readBoard(root).map((f) => [f.slug, f.mapAction]));
  assert.deepEqual(action, { bare: 'chart', decided: 'slice', foggy: 'chart', nomap: null, open: null, sliced: null });
});

test('nextTicketNumber continues after the highest numbered Ticket', () => {
  const t = '# T\n\nType: task\nStatus: open\n';
  const root = scratchTree({
    none: { 'map.md': '# Map: N\n' },
    some: { 'map.md': '# Map: S\n', 'issues/01-a.md': t, 'issues/05-e.md': t, 'issues/03-c.md': t, 'loose.md': '# L\n\nStatus: open\n' },
  });
  const next = Object.fromEntries(readBoard(root).map((f) => [f.slug, nextTicketNumber(f)]));
  assert.deepEqual(next, { none: '01', some: '06' });
});
