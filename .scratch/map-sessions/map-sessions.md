# Map Sessions

Status: resolved

## Problem Statement

When I've only charted a Map with the wayfinder skill, Scratchboard gives me nothing to do with it. A Feature folder that has a `map.md` but no Tickets isn't shown on the board at all, and every board action (Grill, Implement) starts from one Ticket. So I can't use the board to turn the Map into Tickets: not the Decision Tickets wayfinder should chart from it, and not the Build Tickets `/to-tickets` should slice it into once every decision is made. I have to leave the board, remember which skill fits the Map's current state, and start it by hand with the right instructions.

## Solution

A Map gets its own Sessions. Each Feature with a Map shows a lane, even when it has no Tickets, and the lane has an action that Launches a Session on the Map:

- A **chart Session** runs `/wayfinder` to turn the Map (and its Fog) into Decision Tickets.
- A **slice Session** runs `/to-tickets` to turn a Map whose decisions are all made into Build Tickets.

The board picks which one to offer from the Map's state, and the other is always available as a second choice. Both are interactive, like a grill Session, because both skills ask me questions. New Tickets show up in the same lane as the Sessions write them.

## User Stories

1. As a developer who has only charted a Map, I want the Feature to appear on the board as a lane, so that I can see it exists and act on it.
2. As a developer, I want a map-only lane to show the Map's title and empty columns, so that it looks like every other Feature.
3. As a developer whose Map has no Tickets yet, I want the lane's main action to start a chart Session, so that wayfinder writes the Decision Tickets.
4. As a developer whose Map still has Fog under "Not yet specified", I want the main action to start a chart Session, so that the Fog graduates into Decision Tickets.
5. As a developer whose Decision Tickets are all Resolved and whose Map has no Fog, I want the main action to start a slice Session, so that the Map becomes Build Tickets.
6. As a developer, I want the skill the board didn't pick to still be offered as a second choice, so that I can override a wrong guess.
7. As a developer, I want to see which skill an action will run before I click it, so that I'm never surprised by what starts.
8. As a developer, I want a chart Session to read the existing Map and not create a new one, so that my Destination, Notes and Fog are kept.
9. As a developer, I want a chart Session to write Decision Tickets and wire their Blockers, then stop, so that it charts without resolving any Ticket.
10. As a developer, I want a chart Session to fire research subagents for the research Tickets it writes, so that wayfinder's charting step behaves as usual.
11. As a developer, I want a slice Session to build from the Map's "Decisions so far" and the Resolved Decision Tickets, so that the Build Tickets reflect what was decided.
12. As a developer, I want a slice Session to ask me to approve the breakdown before it writes Tickets, so that I keep `/to-tickets`' review step.
13. As a developer, I want Build Tickets written in the same Feature's issues folder, so that the decisions and the work stay in one lane.
14. As a developer, I want Build Tickets numbered after the highest existing Ticket number, so that no Decision Ticket file is clashed with or overwritten.
15. As a developer, I want Build Tickets' Blockers to use those continued numbers, so that blocking works across the whole Feature.
16. As a developer, I want Map Sessions to run in the main checkout, so that they edit the real Map and Tickets.
17. As a developer, I want Map Sessions to run in tmux or the built-in terminal like any other Session, so that I can Open and talk to them.
18. As a developer, I want the Map's action to turn into **Open** while its Session is running, so that I can't Launch two Sessions on the same Map.
19. As a developer, I want Launching on a Map to leave `map.md` unchanged, so that wayfinder's map format isn't altered.
20. As a developer, I want to Relaunch an ended Map Session while the board is still running, so that I can pick the conversation back up.
21. As a developer, I accept that after a board restart I start a new Map Session instead of resuming the old one.
22. As a developer, I want to stop a running Map Session from the board, so that I can abandon it the way Release closes a Ticket's Session.
23. As a developer, I want a notification when a Map Session ends without writing any new Tickets, so that I notice a stalled or abandoned run.
24. As a developer, I want the usual "Ticket is Ready" behaviour to cover Tickets a Map Session writes, so that I don't get a second, duplicate notification.
25. As a developer, I want to override the chart and slice prompts per repo, so that I can tune them like the grill and implement prompts.
26. As a developer with a Feature that has Tickets but no Map, I want no Map action shown, so that the board only offers what makes sense.
27. As a developer who hides Resolved Tickets, I want a map-only lane to stay visible, so that hiding finished work doesn't hide a Map that needs charting.

## Implementation Decisions

- **Reading Features**: the board reader keeps a Feature that has a `map.md` even when it has no Tickets. A Feature with neither is still skipped.
- **Map state**: the reader reports, per Feature:
  - whether the Map has Fog, meaning its "Not yet specified" section has content other than whitespace and HTML comments;
  - which Tickets are Decision Tickets (they carry a wayfinder `Type:` line) and which are Build Tickets (everything else);
  - whether every Decision Ticket is Resolved.
- **Choosing the main action**:
  - No Tickets, or the Map has Fog → chart.
  - Otherwise, every Decision Ticket is Resolved and there are no Build Tickets yet → slice.
  - Otherwise there's no main action, and both chart and slice are offered as second choices.
  - Whenever there is a main action, the other skill is offered as a second choice.
- **Map Session identity**: a Map Session is keyed by the Feature slug plus a fixed Map suffix (for example `<slug>/map`). That can't clash with a Ticket key, because Ticket names start with a number. It runs as a window/terminal in the existing Session backends, and is listed, opened and killed through the same Sessions layer as Ticket Sessions, always in the main checkout (no worktree).
- **Claim**: nothing is written to any file. The board treats a Map as taken while its Session is alive, and refuses a second chart or slice Launch on it (409). The Session id and kind (chart or slice) are held in the server's memory only, which is what Relaunch uses. Both are lost when the board stops.
- **New server actions**: Launch chart on a Feature, Launch slice on a Feature, plus Map-level Open, Relaunch and stop. They follow the same busy guard and error shape as the Ticket actions.
- **Board snapshot**: each Feature also carries its Map state, the main action (chart, slice or none), and the Map Session's status (running, ended or none).
- **UI**: the lane header shows the main action as a button naming its skill (for example "Chart with wayfinder", "Slice into Tickets"), with the other choice in a small secondary control. While the Map Session runs, the button becomes **Open**, with a way to stop it. Once it has ended, **Relaunch** appears while the board is still running. A lane with a Map stays visible when Resolved Tickets are hidden.
- **Prompts**: two new default prompt templates, chart and slice, next to the grill and implement ones, using the same `{{var}}` substitution. They can be overridden per repo with `.scratch/scratchboard-prompt-chart.md` and `.scratch/scratchboard-prompt-slice.md`. The new defaults must be included in the npm package's published files.
  - **Chart prompt**: run `/wayfinder` on the existing Map at its absolute path. Skip charting steps 1–3 (the Map exists; don't rewrite its Destination or Notes). Do step 4: write Decision Tickets into the Feature's issues folder from the Destination, Notes and Fog, numbered after the highest existing Ticket, then wire the Blockers and move whatever Fog became sharp out of "Not yet specified". Do step 5 (research subagents). Resolve no Ticket, and stop.
  - **Slice prompt**: run `/to-tickets` using the Map's Decisions so far and the Resolved Decision Tickets as the source. Quiz me on the breakdown as the skill says. Write Build Tickets into the same issues folder, numbered after the highest existing Ticket, with Blockers using those numbers, and `Status: ready-for-agent`. Don't modify the Map or any Decision Ticket.
- **Notification**: when a Map Session goes from running to ended and the Feature has no Tickets beyond those it had at Launch, notify "Map Session ended" with the Feature and the kind of Session. New Tickets rely on the existing notifications.
- **Glossary**: Session, Launch, Decision Ticket, Build Ticket and Fog are already updated in GLOSSARY.md. The README's "Where Tickets are read from" and action bullets get a line each for chart and slice Sessions.

## Testing Decisions

- Test external behaviour only: what the reader reports for a given `.scratch` tree, and what the claim helpers do to file text. Don't test how either one is put together.
- **Reader tests** (in the existing tickets test file, built on temp `.scratch` trees like the current `readBoard` tests):
  - A map-only Feature is returned.
  - A Feature with neither a Map nor Tickets is not returned.
  - Fog is detected, and a section holding only comments or whitespace counts as no Fog.
  - Decision Tickets and Build Tickets are told apart.
  - The main action is chart, slice or none across the states listed under "Choosing the main action".
- **Numbering**: test the helper that gives the next free Ticket number, if one is added (for example after 01–05 it gives 06; with no Tickets it gives 01).
- **Prompts**: test that a repo override replaces the default for chart and slice, and that the variables are filled in.
- Sessions, backends and the UI stay untested by automation, as today. Check them by running the board on a sample repo with a map-only Feature.
- Run tests with a single worker (`npm test` already uses `--test-concurrency=1`).

## Out of Scope

- Changing how Decision Tickets are grilled or resolved. Today, dragging one to Grilling runs `/grill-me` and writes an Agent Brief and `ready-for-agent`, not wayfinder's `## Answer` and `resolved`. That's a separate follow-up.
- Running `/to-spec` before `/to-tickets`, or any spec step.
- Writing any claim or status into `map.md`, and keeping Map Session ids across a board restart.
- Resolving Tickets from a chart Session (wayfinder's "Work through the map" mode).
- Creating a Map from the board (wayfinder's charting steps 1–3).
- Non-local issue trackers (GitHub, GitLab, Linear).

## Further Notes

- Decided in a grilling session on 2026-10-21. No ADR: each choice is cheap to reverse.
- Once Build Tickets exist, the board offers no main action (both skills remain second choices). That stops it from suggesting a second slice of an already-sliced Map. Confirmed after grilling.

## Answer

Built on 2026-10-21. A Feature with a `map.md` now gets a lane even with no Tickets. The lane header offers **Chart with /wayfinder** and **Slice with /to-tickets**, with the suggested one highlighted. Each starts an interactive Session on the Map in the main checkout, using `prompt-chart.md` or `prompt-slice.md` (both can be overridden in `.scratch/`). The running Session is the only guard, and Relaunch is kept in memory. Map Sessions get Open/Stop, Relaunch/Close once ended, and a notice when one ends having written no new Tickets. Tests cover map-only Features, Fog, Ticket kinds, the main action, the next Ticket number and prompt overrides.

Known gap: Tickets that a Map Session writes already Ready don't get their own "Ticket is Ready" notice. That notice only fires on Blocked → Ready, as before.
