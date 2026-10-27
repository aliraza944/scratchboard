# Scratchboard

A live board of the local tickets that the wayfinder and grilling skills write into a repo's `.scratch` folder. It shows which tickets you can take now and launches an agent session on one.

## Language

### Tickets

**Ticket**:
One unit of work or decision, written as one file in a Feature's issues folder.
_Avoid_: Issue, task, card (a card is only how a Ticket is drawn)

**Decision Ticket**:
A Ticket whose resolution is a decision or a fact, not built work: what wayfinder charts from a Map.
_Avoid_: Question, wayfinder ticket

**Build Ticket**:
A Ticket whose resolution is built work: a slice of the Feature that an implement Session or a person delivers.
_Avoid_: Implementation ticket, slice

**Feature**:
One `.scratch/<slug>` folder: a set of related Tickets, usually described by a Map.
_Avoid_: Spec, project, epic

**Map**:
The file that describes a Feature: its destination, its notes and the decisions made so far.
_Avoid_: Index, overview

**Fog**:
In-scope work a Map names under "Not yet specified" because it can't yet be stated sharply enough to be a Ticket.
_Avoid_: Backlog, TODO, later

**Blocker**:
A Ticket that has to be resolved before another Ticket can start.
_Avoid_: Dependency, prerequisite

### Ticket states

**Blocked**:
An open Ticket that has at least one unresolved Blocker.

**Ready**:
An open, unclaimed Ticket whose Blockers are all resolved. It can be moved to Grilling or straight to In progress.
_Avoid_: Frontier (the wayfinder's word for the set of Ready Tickets), available, unblocked

**Grilling**:
A Ticket claimed by a grill Session: you are being interviewed about it, and nothing is being built yet.
_Avoid_: Refining, specifying

**Ready for agent**:
A Ticket specified well enough for an agent to build without you, marked `ready-for-agent`. It is the skills' signal that grilling is done.
_Avoid_: Grilled, approved, done grilling

**In progress**:
A Ticket being built, by an implement Session or by a person.
_Avoid_: Claimed, assigned, active

**Resolved**:
A Ticket whose answer has been written, or, for a Build Ticket, whose work has Landed.
_Avoid_: Done, closed

**Held**:
An In-progress Ticket whose implement Session has finished building but can't Land yet, and says why. It stays In progress until the Session retries.
_Avoid_: Stuck, failed, blocked (Blocked is about Blockers)

### Sessions

**Agent Brief**:
The section a grill Session writes into a Ticket: the self-contained contract an implement Session builds from.
_Avoid_: Spec, summary, notes

**Launch**:
Starting a Session. On a Ticket it also claims the Ticket: a grill Session when it moves to Grilling, an implement Session when it moves to In progress. On a Map nothing is claimed; while its chart or slice Session is running, no other Session can be Launched on that Map.
_Avoid_: Start, run, dispatch

**Land**:
Putting a Build Ticket's work onto the branch it was started from, as a straight continuation of that branch's history. An implement Session Lands its own work before it Resolves the Ticket.
_Avoid_: Merge, integrate, ship

**Release**:
Clearing a Grilling or In-progress Ticket's claim so that it is open again.
_Avoid_: Unclaim, cancel, reset

**Session**:
One interactive agent conversation working on exactly one Ticket or exactly one Map. A grill Session interviews you about a Ticket; an implement Session builds a Ticket. A chart Session turns a Map's Fog (or a Map with no Tickets yet) into Decision Tickets; a slice Session turns a Map whose Decision Tickets are all Resolved and whose Fog is gone into Build Tickets.
_Avoid_: Agent, job, worker

**Harness**:
The agent CLI a Session runs in: Claude Code (the default) or Codex. You pick it on each Launch, and nothing saves it. A Session stays in the Harness it was Launched in, so Relaunch resumes it there.
_Avoid_: Agent (the claim's `agent` is whoever holds the Ticket), model, provider
