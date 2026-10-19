// Writes a Launch's claim into a Ticket file, and clears it on Release.
// Only the Status and Assignee header lines are touched.
import fs from 'node:fs';

const statusRe = /^(\s*(?:\*\*)?status(?::\*\*|\*\*:|:)\s*)(.*)$/im;
const assigneeRe = /^\s*(?:\*\*)?assignee(?::\*\*|\*\*:|:).*(?:\r?\n)?/im;

export function claimText(text, assignee, status = 'in-progress') {
  const bold = /^\s*\*\*status:\*\*/im.test(text);
  const assigneeLine = bold ? `**Assignee:** ${assignee}` : `Assignee: ${assignee}`;
  let out = text.replace(assigneeRe, '');
  if (statusRe.test(out)) {
    out = out.replace(statusRe, (_, head) => `${head}${status}\n${assigneeLine}`);
  } else {
    // No Status line: add both under the title.
    out = out.replace(/^(# .*\r?\n)/m, `$1\nStatus: ${status}\n${assigneeLine}\n`);
  }
  return out;
}

export function releaseText(text) {
  // to-tickets writes bold headers and uses `ready-for-agent`; wayfinder uses `open`.
  // A Ticket that was grilled to ready-for-agent keeps that.
  const bold = /^\s*\*\*status:\*\*/im.test(text);
  return text
    .replace(assigneeRe, '')
    .replace(statusRe, (_, head, cur) => `${head}${bold || /^ready[- ]for[- ]agent/i.test(cur.trim()) ? 'ready-for-agent' : 'open'}`);
}

export function claimFile(file, assignee, status) {
  fs.writeFileSync(file, claimText(fs.readFileSync(file, 'utf8'), assignee, status));
}

export function releaseFile(file) {
  fs.writeFileSync(file, releaseText(fs.readFileSync(file, 'utf8')));
}
