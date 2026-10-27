import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchRollout, scanRollouts } from '../src/codex.js';
import { replaceAssigneeText } from '../src/claims.js';

const since = Date.parse('2026-10-27T10:00:00Z');
const rollout = ({ id = 'aaaaaaaa-0000-7000-8000-000000000001', cwd = '/repo', at = '2026-10-27T10:00:03Z', prompt }) => [
  { type: 'session_meta', payload: { id, cwd, timestamp: at } },
  { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<skills_instructions>' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>/repo</environment_context>' }] } },
  ...(prompt ? [{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } }] : []),
].map((e) => JSON.stringify(e)).join('\n');

const firstLine = '$grill-me the Ticket at /repo/.scratch/f/issues/02-x.md (X)';

test('a rollout is the Session\'s only with the same cwd, a later start and the same first prompt', () => {
  const prompt = `${firstLine}\n\nScratchboard has put this Ticket in Grilling`;
  assert.equal(matchRollout(rollout({ prompt }), { cwd: '/repo', since, firstLine }), 'aaaaaaaa-0000-7000-8000-000000000001');
  assert.equal(matchRollout(rollout({ prompt, cwd: '/elsewhere' }), { cwd: '/repo', since, firstLine }), null, 'other folder');
  assert.equal(matchRollout(rollout({ prompt, at: '2026-10-27T09:00:00Z' }), { cwd: '/repo', since, firstLine }), null, 'started before the Launch');
  assert.equal(matchRollout(rollout({ prompt: '$grill-me the Ticket at /repo/.scratch/f/issues/03-y.md (Y)' }), { cwd: '/repo', since, firstLine }), null, 'another Ticket');
  assert.equal(matchRollout(rollout({}), { cwd: '/repo', since, firstLine }), null, 'no prompt written yet');
});

test('scanRollouts finds the matching rollout in Codex\'s day folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-codex-'));
  const now = Date.now();
  const d = new Date(now);
  const dir = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const at = new Date(now + 1000).toISOString();
  fs.writeFileSync(path.join(dir, 'rollout-a-other.jsonl'), rollout({ id: 'other', at, prompt: '$implement /repo/.scratch/f/issues/09-z.md' }));
  fs.writeFileSync(path.join(dir, 'rollout-b-mine.jsonl'), rollout({ id: 'mine', at, prompt: firstLine }));
  assert.equal(scanRollouts({ cwd: '/repo', since: now - 5000, firstLine, root }), 'mine');
  assert.equal(scanRollouts({ cwd: '/other', since: now - 5000, firstLine, root }), null);
});

test('a Codex claim gets its id only while it is still the pending claim', () => {
  const text = '# T\n\nStatus: grilling\nAssignee: agent (codex grill session, 2026-10-27)\n';
  const from = 'agent (codex grill session, 2026-10-27)';
  const to = 'agent (codex grill session 1234, 2026-10-27)';
  assert.match(replaceAssigneeText(text, from, to), /Assignee: agent \(codex grill session 1234, 2026-10-27\)/);
  const released = '# T\n\nStatus: open\n';
  assert.equal(replaceAssigneeText(released, from, to), released);
  const reclaimed = text.replace(from, 'me');
  assert.equal(replaceAssigneeText(reclaimed, from, to), reclaimed);
});
