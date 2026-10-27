import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPrompt } from '../src/prompts.js';

test('chart and slice prompts fill in the Map and the next Ticket number', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const vars = { mapPath: '/r/.scratch/f/map.md', issuesDir: '/r/.scratch/f/issues', nextNumber: '06' };
  for (const kind of ['chart', 'slice']) {
    const text = renderPrompt(root, kind, vars);
    assert.match(text, kind === 'chart' ? /\/mattpocock-skills:wayfinder/ : /\/mattpocock-skills:to-tickets/);
    assert.ok(text.includes('/r/.scratch/f/map.md'), `${kind} names the Map`);
    assert.ok(text.includes('06'), `${kind} names the next number`);
    assert.doesNotMatch(text, /\{\{\w+\}\}/);
  }
});

test('a repo prompt in .scratch replaces the default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  fs.mkdirSync(path.join(root, '.scratch'));
  fs.writeFileSync(path.join(root, '.scratch', 'scratchboard-prompt-slice.md'), 'Slice {{mapPath}} from {{nextNumber}} {{unknown}}.');
  assert.equal(renderPrompt(root, 'slice', { mapPath: 'm.md', nextNumber: '04' }), 'Slice m.md from 04 .');
  assert.match(renderPrompt(root, 'chart', { mapPath: 'm.md' }), /wayfinder/, 'chart keeps its default');
  fs.writeFileSync(path.join(root, '.scratch', 'scratchboard-prompt-chart.md'), 'Chart {{mapTitle}}.');
  assert.equal(renderPrompt(root, 'chart', { mapTitle: 'Billing' }), 'Chart Billing.');
});

test('the implement prompt has a step for Landing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const text = renderPrompt(root, 'implement', { ticketPath: 't.md', landStep: 'Land on A.' });
  assert.match(text, /4\. Land on A\./);
  assert.doesNotMatch(text, /\{\{\w+\}\}/);
});
