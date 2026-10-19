# Scratchboard

A live board of the local tickets that the wayfinder and grilling skills write into a repo's `.scratch` folder. It shows which tickets you can take now and launches an agent session on one.

## Language

### Tickets

**Ticket**:
One unit of work or decision, written as one file in a Feature's issues folder.
_Avoid_: Issue, task, card (a card is only how a Ticket is drawn)

**Feature**:
One `.scratch/<slug>` folder: a set of related Tickets, usually described by a Map.
_Avoid_: Spec, project, epic

**Map**:
The file that describes a Feature: its destination, its notes and the decisions made so far.
_Avoid_: Index, overview

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
A Ticket whose answer or work has been written and accepted.
_Avoid_: Done, closed

### Sessions

**Agent Brief**:
The section a grill Session writes into a Ticket: the self-contained contract an implement Session builds from.
_Avoid_: Spec, summary, notes

**Launch**:
Claiming a Ticket and starting a Session on it: a grill Session when it moves to Grilling, an implement Session when it moves to In progress.
_Avoid_: Start, run, dispatch

**Release**:
Clearing a Grilling or In-progress Ticket's claim so that it is open again.
_Avoid_: Unclaim, cancel, reset

**Session**:
One interactive agent conversation working on exactly one Ticket. A grill Session interviews you about it; an implement Session builds it.
_Avoid_: Agent, job, worker
