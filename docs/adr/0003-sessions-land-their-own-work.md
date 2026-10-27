# Implement Sessions Land their own work by rebase and fast-forward before they Resolve

An implement Session still builds in its own worktree and branch, cut from whatever the main checkout has checked out at Launch. Its last step is now to Land: rebase its branch onto that branch inside the worktree, fix conflicts and re-run the tests there, then fast-forward the main checkout's branch (`merge --ff-only`). Only then does it write `Status: resolved`, with a `Landed:` line. Scratchboard removes the worktree and safe-deletes the branch once a Landed Ticket's Session has ended. Before this, every finished branch had to be merged and cleaned up by hand. Dependent Tickets also became Ready while their Blockers' code was still on unmerged branches, so their worktrees were cut without it.

## Consequences

- The Session never touches your in-flight work. If the main checkout is on another branch, or the fast-forward is refused because your uncommitted edits overlap, or it can't fix a conflict, it doesn't stash, reset or force. It writes `Landing: held (<reason>)`, the Ticket stays In progress (Held), and you ask it to retry.
- History stays linear: one series of commits per Ticket, no merge commits.
- Landing still updates the files in your main checkout, because the branch it lands on is checked out there.
- Nothing is reviewed before it lands. You review the branch's history afterwards, like any other commit.

## Considered Options

- **Merge commit per Ticket**: keeps the branch shape, but the history gets noisy and conflicts still need a human.
- **Cherry-pick straight onto the branch in the main checkout**: it's the same commits, but conflicts would leave markers in the files you're editing.
- **Scratchboard lands on Resolved**: hands-off, but the board can't fix a conflict or a failing test. The Session has the context to do both.
- **No worktrees, build in the main checkout**: nothing to land, but no parallel implement Sessions.
