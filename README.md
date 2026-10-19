# Scratchboard

A live board of the Tickets in a repo's `.scratch/<feature>/issues/`, the ones that the wayfinder, grilling and to-tickets skills write. Drag a Ready Ticket to In progress to start a `claude` Session on it in tmux. Vocabulary: [GLOSSARY.md](GLOSSARY.md).

```bash
scratchboard .          # the board for this directory exactly (no walking up to a parent)
scratchboard ~/projects/shadi-invite --port 4747 --no-open
```

- **Where Tickets are read from**: the skills' local-markdown tracker convention (setup-matt-pocock-skills). That means `.scratch/<feature>/issues/NN-slug.md` (wayfinder, to-tickets), plus any `.md` directly in `.scratch/<feature>/` that has a `Status:` line (what triage and to-spec write when they "publish to the issue tracker"). `map.md` and `spec.md` are never Tickets. Status words: `open`, `needs-triage`, `ready-for-agent` and `ready-for-human` are open; `claimed`, `grilling` and `in-progress` are claimed; `needs-info` is Blocked; `resolved`, `closed` and `wontfix` are Resolved.
- **Columns**: Blocked → Ready → Grilling → In progress → Resolved. They're worked out from each Ticket's `Status`, `Assignee` and `Blocked by` lines. Nothing is stored apart from the Ticket files.
- **Grill** (drag Ready → Grilling): writes `Status: grilling` and `Assignee: agent (grill session <id>, <date>)`, then starts `/mattpocock-skills:grill-me` in the main checkout. When you confirm a shared understanding, the Session writes an `## Agent Brief` into the Ticket and sets `Status: ready-for-agent`. The card then shows **grilled · ready for agent**, and you drag it on.
- **Implement** (drag Ready or Grilling → In progress): closes any grill Session, writes `Status: in-progress` and `Assignee: agent (session <id>, <date>)`, then starts a fresh `/mattpocock-skills:implement` that builds from the Agent Brief. In a git repo it runs in a worktree at `../<repo>-worktrees/<feature>-<ticket>` on branch `sb/<feature>/<ticket>`. Tickets that /to-tickets already marked `ready-for-agent` can skip Grilling.
- Sessions run in tmux session `sb-<repo>`, one window per Ticket. **Open** pops up Ptyxis attached to it. **Relaunch** resumes an ended Session's conversation. **Release** (or dragging back to Ready) clears the claim and closes the window.
- **Prompts**: [prompt-grill.md](prompt-grill.md) and [prompt-implement.md](prompt-implement.md). To override either for one repo, add `.scratch/scratchboard-prompt-grill.md` or `.scratch/scratchboard-prompt-implement.md`.
- Sessions edit Tickets in the main checkout, even from a worktree: [ADR 0001](docs/adr/0001-tickets-edited-in-main-checkout.md).
- Desktop notifications (`notify-send`) fire when a Ticket is resolved, when a Ticket becomes Ready, and when a Session ends unresolved.

Tests: `npm test` (runs one test file at a time).
