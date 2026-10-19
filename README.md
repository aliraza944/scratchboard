# Scratchboard

A live board of the Tickets in a repo's `.scratch/<feature>/issues/`, the ones that the wayfinder, grilling and to-tickets skills write. Drag a Ready Ticket to In progress to start a `claude` Session on it in tmux. Vocabulary: [GLOSSARY.md](GLOSSARY.md).

```bash
scratchboard                 # the board for this directory, started in the background
scratchboard ~/projects/foo  # or for another directory
scratchboard stop            # stop this directory's board
```

Options: `--port N` (default 4747, or the next free one), `--backend auto|tmux|pty`, `--no-open`, `--foreground`. One board runs per directory; running `scratchboard` again just reopens it. Logs and state files live in `~/.local/state/scratchboard/` (`%LOCALAPPDATA%\scratchboard` on Windows).

**Sessions** run in **tmux** when it's installed, otherwise in a **built-in terminal** shown in the board's Session tab (node-pty, works on Windows, macOS and Linux). See [ADR 0002](docs/adr/0002-tmux-first-pty-fallback.md). Install with `npm install` (Windows and macOS get prebuilt node-pty binaries; Linux compiles it, which needs a C++ toolchain and Python).


- **Where Tickets are read from**: the skills' local-markdown tracker convention (setup-matt-pocock-skills). That means `.scratch/<feature>/issues/NN-slug.md` (wayfinder, to-tickets), plus any `.md` directly in `.scratch/<feature>/` that has a `Status:` line (what triage and to-spec write when they "publish to the issue tracker"). `map.md` and `spec.md` are never Tickets. Status words: `open`, `needs-triage`, `ready-for-agent` and `ready-for-human` are open; `claimed`, `grilling` and `in-progress` are claimed; `needs-info` is Blocked; `resolved`, `closed` and `wontfix` are Resolved.
- **Columns**: Blocked → Ready → Grilling → In progress → Resolved. They're worked out from each Ticket's `Status`, `Assignee` and `Blocked by` lines. Nothing is stored apart from the Ticket files.
- **Grill** (drag Ready → Grilling): writes `Status: grilling` and `Assignee: agent (grill session <id>, <date>)`, then starts `/mattpocock-skills:grill-me` in the main checkout. When you confirm a shared understanding, the Session writes an `## Agent Brief` into the Ticket and sets `Status: ready-for-agent`. The card then shows **grilled · ready for agent**, and you drag it on.
- **Implement** (drag Ready or Grilling → In progress): closes any grill Session, writes `Status: in-progress` and `Assignee: agent (session <id>, <date>)`, then starts a fresh `/mattpocock-skills:implement` that builds from the Agent Brief. In a git repo it runs in a worktree at `../<repo>-worktrees/<feature>-<ticket>` on branch `sb/<feature>/<ticket>`. Tickets that /to-tickets already marked `ready-for-agent` can skip Grilling.
- With tmux, Sessions run in tmux session `sb-<repo>`, one window per Ticket, and **Open** pops up a terminal attached to it (Ptyxis, x-terminal-emulator, or Terminal.app on macOS). With the built-in terminal, **Open** shows the live Session in the panel's Session tab, and Sessions end when the board stops. **Relaunch** resumes an ended Session's conversation. **Release** (or dragging back to Ready) clears the claim and closes the window.
- **Prompts**: [prompt-grill.md](prompt-grill.md) and [prompt-implement.md](prompt-implement.md). To override either for one repo, add `.scratch/scratchboard-prompt-grill.md` or `.scratch/scratchboard-prompt-implement.md`.
- Sessions edit Tickets in the main checkout, even from a worktree: [ADR 0001](docs/adr/0001-tickets-edited-in-main-checkout.md).
- Desktop notifications (`notify-send` on Linux, `osascript` on macOS, browser notifications on Windows) fire when a Ticket is resolved, when a Ticket becomes Ready, and when a Session ends unresolved.

Tests: `npm test` (runs one test file at a time).
