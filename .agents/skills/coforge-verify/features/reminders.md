# Reminders

Agents schedule reminders for themselves; people can only view them. A reminder
wakes only the Agent that scheduled it (Agent Manual,
`apps/web/src/server/agents/manual/topics/reminders.md`). The Daemon mirrors the
schedule and arbitrates due times over WSS (`packages/daemon/src/agent-reminder/`).

## reminder-schedule

- **Reach**: the Agent CLI, from inside an Agent session:
  `coforge reminder schedule --title … --target … --message-id …` with exactly
  one of `--delay-seconds`, `--fire-at` or `--repeat`; also
  `list|update|snooze|cancel|log|ack|dismiss` (`packages/coforge/index.ts`).
  HTTP: `apps/web/src/routes/api/agent/v1/reminders.ts`.
- **Drive**: there is no create or edit control in the Web. Ask a real Agent in a
  DM to schedule a short reminder (for example in two minutes) that posts a
  unique marker to that DM.
- **Success**: the reminder appears on the Agent's Reminders tab (below), and at
  the due time the Agent wakes and posts the marker. That a fired one-off
  reminder then leaves the scheduled list is unverified.
- **Traps**:
  - The cloud schedule is authoritative and the Daemon keeps only a mirror
    plus durable fire receipts, and never wakes an Agent before the cloud
    accepts the fire (`packages/daemon/src/agent-reminder/AGENTS.md`). For a
    Daemon change, verify a reminder that falls due across a
    `coforge-computer restart`.
  - Chat groups reminder-pattern system messages as "N reminder updates"
    (`system-message-groups.ts`). What posts those messages, and whether the
    `ReminderNotices` server module is wired in, is unverified.
- **Covered by**: no end-to-end test. Below the product:
  `apps/web/test/reminder.integration.ts`, `reminders.test.ts`,
  `reminder-rpc-methods.test.ts`, `agent-reminders-http-route.test.ts`,
  `packages/daemon/test/reminder-scheduler.test.ts`,
  `packages/coforge/test/reminder-duration.test.ts`.

## reminders-tab

- **Reach**: `/en/w/<slug>/members?profile=agent:<uuid>&agentTab=reminders`, or
  the "Reminders" tab in the profile's "Agent" tablist.
- **Drive**: read only. "Load more" pages; "Retry" after "Reminders could not
  be loaded.".
- **Success**: each scheduled reminder shows its title, fire time, a recurrence
  line ("Daily at 09:30", "Every N minutes", "Weekly on …") and a source link
  (`#channel` or the target). An Agent with none shows "No active reminders".
  Only scheduled reminders are listed
  (`apps/web/src/server/agents/agent-reminders.server.ts`).
- **Traps**: managers see the tab, but only the Agent's owner sees its contents;
  everyone else gets "Only the Agent owner can view reminders."
  (`agent-reminders.tsx`). The dev seed (`bun run seed:dev`) gives the dev
  user's Agent Atlas a reminder "Post the weekly release summary" to `#general`;
  the seeded Agent Nova belongs to another user, so the dev user sees only the
  owner-only message there.
- **Covered by**: no browser e2e.
