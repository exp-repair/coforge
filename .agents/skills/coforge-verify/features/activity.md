# Activity view

The Workspace inbox of conversations with new activity. Not to be confused
with an Agent's Activity tab ([agents](agents.md#agent-activity-tab)).
Code: `apps/web/src/features/inbox/activity-inbox-view.tsx`; server
`apps/web/src/server/inbox/activity-inbox.server.ts`. No `data-testid`.

## activity-inbox

- **Reach**: sidebar link "Activity" (shows an unread dot), or
  `/en/w/<slug>/activity`. Params: `filter=unread|mentions` (All has none);
  `open=channel:<uuid>|dm:<uuid>`, `msg=<uuid>`, `threadRootId=<uuid>`. Changing
  the filter keeps the open conversation.
- **Drive**:
  - heading "Activity"; `[data-activity-active-count]` reads "N active";
  - tablist "Filter Activity" with tabs All, Unread, Mentions (counts follow the
    label; All has none); "Mark all read" appears only when something is unread;
  - on All's first page, `ol[aria-label="Pinned"]`, then the heading "All
    conversations" and `ol[aria-label="Activity"]`; Mentions has no Pinned list;
  - each row is a link (`aria-current="true"` when open), with an "N new" badge
    when unread. Right-click opens "Activity item actions": "Mark as Read" or
    "Mark as Unread", "Done", "Unfollow thread"; a hover button is
    "Mark as Done".
- **Success**:
  - at `lg` width and above, a click opens `section[aria-label="Selected conversation"]`
    beside the list, `open=` appears in the URL, the pane contains
    `#message-<id>`, and reload reopens the pane;
  - below `lg`, a click navigates to `/w/<slug>/channel/<id>` (or the DM);
  - pinned conversations are listed first in All.
- **Traps**:
  - The open conversation has its own tabs; click filters inside the
    "Filter Activity" tablist.
  - The pane's messages are also `li`; scope rows to
    `ol[aria-label="Activity"] > li`.
  - Wait for hydration before clicking, and for the previous context menu to
    close before opening the next.
- **Covered by**: `apps/web/test/e2e-activity-inbox.e2e.ts` (list, filters,
  menu, Done, open beside, phone width; member and self DMs; Pinned). Server
  ordering: `activity-inbox.integration.ts`,
  `activity-nav-attention-plan.integration.test.ts`
  (`mise run test:integration:web`).
