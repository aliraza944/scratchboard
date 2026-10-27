{{skill:grill-me}} the Ticket at {{ticketPath}} ({{ticketTitle}})

Scratchboard has put this Ticket in Grilling for you (Status: grilling, Assignee: agent (grill session …)). Don't claim it again, and don't work on any other Ticket.

{{mapStep}} Then grill me about this Ticket until we reach a shared understanding. Don't implement anything: a separate implement Session will build it later.

Once I confirm we've reached a shared understanding:
1. Add an `## Agent Brief` section to the Ticket, at the absolute path above. It is the contract a fresh implement Session will build from, without this conversation, so it must stand on its own. Use the triage skill's agent-brief shape:
   - **Summary:** one line on what needs to happen
   - **Current behavior:** the status quo it builds on
   - **Desired behavior:** what should be true afterwards, including edge cases and error conditions
   - **Key interfaces:** the types, function signatures and config shapes to look for or change (no file paths or line numbers)
   - **Acceptance criteria:** concrete checkboxes that can each be tested on their own
   - **Out of scope:** what not to touch
   Record every decision we made, not just the conclusion.
2. Set the Ticket's Status line to `ready-for-agent`. Leave the Assignee line as it is.
3. Tell me it's ready, so I can drag it to In progress on the board.
