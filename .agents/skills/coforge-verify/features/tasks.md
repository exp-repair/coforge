# Tasks and action cards

Code: `apps/web/src/features/tasks/` (rules in its `AGENTS.md`) and
`apps/web/src/features/conversations/action-card.tsx`. English strings:
`apps/web/messages/en/conversations.json`.

## task-board

- **Reach**: Workspace page `/en/w/<slug>/tasks`; a conversation's board via
  the "Tasks" tab in the tablist named "Chat / Tasks" (or "Chat / Tasks /
  Files"), or `?view=tasks&layout=board|list` (also `status`, `owners`,
  `completed`, `projects`) (`task-board-search.ts`).
- **Drive**: "Filter" and "Display" (Display holds "Task layout": "Board",
  "List"). Columns are `section[aria-label="To do"|"In progress"|"In review"|"Done"|"Closed"]`
  with each card an `article`; Done pages with "Load more"
  (`task-workflow.tsx`).
- **Traps**:
  - The two boards are one component, but only a conversation can create Tasks.
  - The conversation tabs can be reordered by the user; select the tab by
    name, never by position.
- **Covered by**: `apps/web/test/e2e-conversation-task-board.e2e.ts` (same
  toolbar on both boards, claim by menu and by drag, Done paging) and
  `e2e-tasks-create-and-scope.e2e.ts` (Tasks page lists channel Tasks only and
  cannot create). Screenshots under `.amp/e2e/conversation-task-board/` and
  `.amp/e2e/tasks-create-and-scope/`.

## task-create

- **Reach**: "Create task" on a conversation's board.
- **Drive**: inputs "Task 1", "Task 2", …; "Add another" adds a row; submit
  reads "Create task" or "Create N tasks" (`create-task-dialog.tsx`).
- **Success**: the cards appear in To do, unassigned, and persist after reload.
  Empty submit shows "Add at least one task title."
- **Traps**: match titles exactly; an Agent may create a planning Task whose
  longer title contains yours.

## task-status-and-owner

- **Reach**: a card's "More actions for task #N" → "View and edit" (detail
  dialog "Task #N"), or "Move to <status>" from the same menu, or drag the
  "Move task #N" handle.
- **Drive**: "Change status: <status>" opens a menu (items are `menuitem`s,
  single selection); "Change owner: <name>" opens "Search members" and a
  "Change owner" menu (`task-detail-dialog.tsx`). Close with the "Close"
  button.
- **Success**: the card moves to the new column with the new owner and keeps
  both after reload. Moving a To do Task to In progress claims it; there is no
  Claim button.
- **Traps**:
  - Wait for the card wrapper's `aria-busy="true"` to clear before reloading;
    optimistic movement is not persistence.
  - Escape did not close the detail dialog in an earlier run; use "Close"
    ([native run guidance](../../../../docs/agents/e2e-testing/native-run-guidance.md)).
  - Use the card's owner label (for example `@dev-user`), not the account
    menu's display name.
  - Reassignment requires the assignee to belong to that conversation.

## agent-task-flow

An Agent claiming, working and submitting a Task.

- **Drive**: in a DM with a real Agent, create a Task and assign it to the
  Agent, or ask the Agent to create a uniquely titled Task, self-assign it and
  submit it for review.
- **Success**: the Agent-owned card reaches In review and stays after reload;
  clicking an Agent-created card navigates to that Agent's message. After a
  human sets Done, it stays in Done and leaves In review.
- **Traps**: an Agent's Task or action card wakes no Agent. The automated
  checks assert board state, not the Agent's CLI calls; read the Agent's
  Activity for those, and record that as diagnostic, not assertion.
- **Covered by**: the Task phases of `scripts/e2e/native-browser.e2e.ts`
  (`create_task`, `await_task_review`, `approve_task`, `agent_create_task`,
  `reassign_task`, `offline_task`, `muted_assignment`; screenshots
  `.amp/in/artifacts/native-browser-*.png`). Several of its selectors are stale
  (see [conversations](conversations.md#stale-selectors-in-older-harnesses)).

## action-card

An Agent-prepared proposal attached to its message, of kind `channel:create`,
`agent:create` or `channel:add_member`
(`packages/coforge-sdk/src/agent/action-cards.ts`).

- **Reach**: ask an Agent to propose creating a channel, an Agent, or adding
  members; the card renders under its message body.
- **Drive**: a "Pending" badge, a commit button ("Create channel", "Create
  agent", "Add members") and "Dismiss". "Must run on <computer>" locks the
  Computer choice for `agent:create`.
- **Success**: the card reads "Done · committed by <name> · <time>" or
  "Cancelled", and the created object exists (sidebar channel, Members-page
  Agent, roster member).
- **Traps**: pending cards refresh on window focus and on new-message signals,
  not continuously.
- **Covered by**: no browser e2e found.
