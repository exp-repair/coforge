# Channels, direct conversations, threads, @mentions

Code: `apps/web/src/features/conversations/` (rules in its `AGENTS.md`).
No `data-testid` exists here; rows carry `data-*` attributes instead.
English strings: `apps/web/messages/en/conversations.json`.

## Shared facts

- **URLs**: chat home `/en/w/<slug>/`; channel `/en/w/<slug>/channel/<uuid>`;
  DM `/en/w/<slug>/dm/<uuid>`; saved `/en/w/<slug>/saved`. There is no
  name-based channel URL; open channels from the sidebar. Search params:
  `threadRootId` (thread pane), `view` (tab), `message` (jump to a message),
  `profile`, `agentTab` (`conversation-page-search.ts`).
- **Client-rendered**: the `_chat` route sets `ssr: false`, so server HTML is
  only a skeleton. The composer is disabled until hydration
  (`composerDisabled = !hydrated` in `message-composer.tsx`); wait for
  `textarea:not([disabled])` before typing. Text typed earlier is lost, and that
  is not a delivery failure
  ([Native run guidance](../../../../docs/agents/e2e-testing/native-run-guidance.md)).
- **Message rows**: `li[data-message-id="<id>"]` containing
  `div#message-<id>[data-message="own"|"other"|"system"]` (`message-row.tsx`).
  An Agent's reply is `data-message="other"` with the Agent's name as sender;
  there is no sender-kind attribute. Before the server accepts a message it is
  `li[data-outbox-state="sending"|"delivered"|"unsent"]`
  (`outbox-message-row.tsx`), replaced by the real row.

## send-message

- **Reach**: sidebar link named `#general` (or any `#<name>`), or a DM.
- **Drive**: textarea named "Message" (sr-only label; placeholder
  `Message #<channel>` or `Message @<name>`), then the "Send" button or Enter.
- **Success**: a new `li[data-message-id]` with `data-message="own"` holds the
  text and survives reload; the outbox row does not stay `unsent`.
- **Traps**: drafts persist in localStorage per conversation and thread, so old
  text can reappear. With a thread open there are two "Message" textboxes;
  pick by placeholder ("Message thread" in the thread).
- **Covered by**: `apps/web/test/e2e-people-direct-message.e2e.ts`,
  `e2e-read-cursor-elsewhere.e2e.ts` (needs `COFORGE_E2E_CENTRIFUGO_URL`, see
  [testing guidance](../../../../docs/agents/testing.md#browser-end-to-end-tests)),
  `e2e-collapse-long-messages.e2e.ts`.

## agent-dm

The default way to make an Agent take a turn.

- **Reach**: "New direct message" in the Direct messages section opens a popover
  with "Search members…" and the tabs "Agent" and "Human"; click a name.
  Or "Private chat" on a Members-page card.
- **Drive**: send a unique marker request, for example
  `Reply with exactly: VERIFY_<random>`.
- **Success**: a `data-message="other"` row from the Agent with the exact
  marker, present before and after reload. For a turn's internals see
  [agent-turn](agent-runtimes.md#agent-turn).
- **Traps**: match the exact marker and the sender, not a substring.
- **Covered by**: `scripts/e2e/native-browser.e2e.ts` (real Computer and Pi).
  `apps/web/test/e2e-agent-direct-message.e2e.ts` (`mise run
  test:e2e:agent-direct-message`) is not a browser test and TRUNCATEs core tables
  and FLUSHDBs Redis: run it only against a disposable database.

## channel-create

- **Reach**: "Create channel" in the sidebar's Channels section; dialog
  "Start channel".
- **Drive**: pick at least two members first, then "Channel name"
  (`^[a-z0-9][a-z0-9_-]{0,31}$`), then "Finish" (`create-channel-dialog.tsx`).
- **Success**: the new `#<name>` appears in the sidebar and opens.
- **Covered by**: none found for creation itself.

## channel-settings

- **Reach**: the header button "Channel details and settings" opens a slideout
  dialog of the same name (`channel-settings-panel.tsx`).
- **Drive**: switches "Pin channel", "Mute activity", "Collapse long messages"
  (read their `.checked`); actions "Stop Agents", "Resume all", "Hide #general",
  "Delete channel"; the Members summary opens the roster with "Add members".
- **Traps**: "Mute activity" changes the human's membership, not an Agent's;
  Agent mute is the Agent command `coforge channel mute`. Clicks before
  hydration do nothing.
- **Covered by**: `e2e-channel-settings.e2e.ts`, `e2e-channel-settings-realtime.e2e.ts`
  (also Centrifugo), `e2e-channel-members-page.e2e.ts`, `e2e-delete-channel.e2e.ts`,
  `e2e-hide-general.e2e.ts`, `e2e-stop-channel-agents.e2e.ts` (needs `REDIS_URL`;
  "Stop Agents" → "Stop" → "All Agents have been stopped."; "Resume all" stays
  disabled until `textarea[aria-label^="Provide new guidance"]` has text).

## thread

- **Reach**: the row's hover button "Reply in thread", or its "N replies"
  preview `[data-thread-preview]`; both set `?threadRootId=`.
- **Success**: the pane scroller `[aria-label="Thread"]` shows the root in
  `[aria-label="Original message"]` and the reply below it.
- **Traps**: the hover toolbar needs the `lg` breakpoint and a fine hover
  pointer; otherwise tapping a row opens `[role=dialog][aria-label="Message actions"]`.
- **Covered by**: `apps/web/test/e2e-channel-thread.e2e.ts` covers Daemon thread
  transport, not the browser (needs Web on 8789 and Centrifugo on 8000).

## mention-agent

- **Reach**: type `@` in a channel composer.
- **Drive**: listbox `[role="listbox"][aria-label="Mention suggestions"]`,
  options `[role="option"]` grouped "In this channel" / "Not in this channel",
  each badged "Agent" or "Human"; Enter or click writes `@Label ` into the text.
- **Success**: the Agent replies in the channel (or in the thread) even when the
  channel is muted for it; a personal @mention overrides mute. There is no
  delivery-status UI in the browser; the Agent CLI reads it with
  `coforge mention delivery --message <id>`.
- **Feedback for people outside the channel**: a pending-mention strip with
  Add, Notify and Ignore; an unresolved-handle notice; a "Did you mean" hint.
- **Traps**: direct conversations between people offer no @-completion and
  deliver to no Agent. An Agent's own message never wakes itself.
- **Covered by**: `apps/web/test/e2e-mention-picker.e2e.ts` (writes
  `summary.json` under `.amp/e2e/`), `e2e-mention-delivery.e2e.ts`
  (`mise run test:e2e:mention-delivery`; artifact
  `.amp/in/artifacts/mention-delivery-<id>.json`), and the live OpenRouter test
  ([openrouter-live](agent-runtimes.md#openrouter-live)).

## Stale selectors in older harnesses

`scripts/e2e/native-browser.e2e.ts` and `native-run-guidance.md` still use
`nav[aria-label="Chat / Tasks"] button:last-child` (now a `tablist` named
"Chat / Tasks" or "Chat / Tasks / Files" whose tab order the user can reorder,
so pick the `tab` by name; `apps/web/src/features/tasks/conversation-task-tabs.tsx`),
an "Assignee handle" field (removed), and expect a disabled textarea in server
HTML (chat is client-rendered). Unverified by a run here; expect those steps to fail until
they are updated, and do not copy those selectors.
