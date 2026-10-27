# Tickets are edited in the main checkout, even when a Session's code lives in a worktree

In a git repo, a launched Session writes its code in its own worktree and branch, but it updates its Ticket (the claim, the Answer, `Status: resolved`, the Map line) at the Ticket's absolute path in the main checkout. Scratchboard watches only the main checkout. Editing the worktree's copy would leave the board stale and keep dependent Tickets Blocked until the branch was merged. We chose a live board and immediate unblocking over keeping the resolution with the code.

## Consequences

- ~~Resolved means "the Session says it's done", not "merged".~~ Superseded by [ADR 0003](0003-sessions-land-their-own-work.md): an implement Session Lands its branch before it Resolves the Ticket.
- The main checkout picks up uncommitted `.scratch` changes while Sessions run.

## Considered Options

- Edit the worktree's copy: strict, but the board is stale and dependents wait until the merge.
- Have the board also read In-progress Tickets from their worktrees: live, and the resolution travels with the branch, but more to build. Revisit if abandoned branches turn out to be common.
