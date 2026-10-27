// Loads a Session's prompt template and fills in its {{vars}}. A repo can replace any
// default with `.scratch/scratchboard-prompt-<kind>.md`. {{skill:<name>}} becomes that
// skill's call in the Session's Harness, so one template serves both.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// grill and implement work on a Ticket; chart and slice work on a Map.
export const PROMPT_KINDS = ['grill', 'implement', 'chart', 'slice'];

const SKILL_CALL = {
  claude: (name) => `/mattpocock-skills:${name}`,
  codex: (name) => `$${name}`,
};

export function renderPrompt(repoRoot, kind, vars, harness = 'claude') {
  if (!PROMPT_KINDS.includes(kind)) throw new Error(`Unknown prompt "${kind}"`);
  const repoTemplate = path.join(repoRoot, '.scratch', `scratchboard-prompt-${kind}.md`);
  const template = fs.readFileSync(fs.existsSync(repoTemplate) ? repoTemplate : path.join(here, '..', `prompt-${kind}.md`), 'utf8');
  return template
    .replace(/\{\{skill:([\w-]+)\}\}/g, (_, name) => SKILL_CALL[harness](name))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}
