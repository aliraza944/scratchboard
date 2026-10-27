# Codex is a second Harness, picked on each Launch, and its session id is found after it starts

Any Session (grill, implement, chart, slice) can now run in Codex instead of Claude Code. The board offers a Claude|Codex toggle beside each Launch, but only when it can find `codex`. The toggle starts on Claude and goes back to Claude after each Launch. Nothing records the choice in the Ticket, map.md or the board's state. Only the claim it leads to does: `agent (codex grill session <id>, <date>)`. Both Harnesses use the same prompt templates. Each one opens with `{{skill:<name>}}`, which renders as `/mattpocock-skills:<name>` for Claude and `$<name>` for Codex.

Claude Code takes a session id up front (`--session-id`), but Codex picks its own. So after a Codex Launch, Scratchboard watches `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` for the Session's rollout. That's the one with the same cwd, started after the Launch, whose first prompt opens with the Launch's first line (which names the Ticket or Map). It then writes the id into the claim. It keeps looking while the Session runs, for up to half an hour, because Codex may wait at its trust prompt before it writes anything.

## Consequences

- Relaunch runs `codex resume <id>` only once the id has been found. If it never is (the Session ended first, or the board stopped while it was looking), Relaunch isn't offered. Scratchboard never falls back to `codex resume --last`, which would resume whichever Codex conversation was most recent, possibly someone else's.
- A Map's Codex id lives in memory like any Map Session's, so it's gone when the board stops.
- Codex sandboxes writes to its working directory. A worktree Session also gets `--add-dir <main checkout>` so it can edit the Ticket there and Land (ADRs 0001 and 0003). Everything else, approvals and sandbox mode included, comes from your `~/.codex/config.toml`.
- A repo prompt override written with a literal `/mattpocock-skills:…` still works in Claude, but not in Codex.
- Discovery depends on Codex's rollout format (`session_meta` first, then `response_item` messages). If Codex changes it, discovery fails safe: no id, no Relaunch.

## Considered Options

- **An `Agent:` line in the Ticket or map.md**: the choice would survive restarts and be visible in the file, but you wanted to choose at Launch time and change it freely. A saved default would also have to be undone for every one-off Codex run.
- **A board-wide switch**: one click for a whole batch, but it's easy to forget it's on, and it hides which Harness the next drag will use.
- **Separate prompt files per Harness**: the wording could be tuned for each, but two copies would drift.
- **Matching rollouts on cwd and time only**: grill and Map Sessions all share the main checkout, so two Codex Sessions started close together could swap ids.
