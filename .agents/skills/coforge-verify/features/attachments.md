# Attachments

Files sent with a message from the composer, and the Agent's access to them.
Code: `apps/web/src/features/conversations/message-composer.tsx`,
`message-row.tsx`; download route `apps/web/src/routes/api/attachments.$attachmentId.ts`.

## attachment-send

- **Reach**: any conversation composer
  ([send-message](conversations.md#send-message)).
- **Drive**: the "Add attachment" button, or set files on the hidden
  `input[type="file"]` (it accepts `multiple`); paste and drag-drop also work.
  The pending tray is `ul[aria-label="Attachments to send"]`; each tile is
  named `"<name> · Uploading N%"`, `"<name> · Upload failed"`, or
  `"<name> · <type> · <size>"` once uploaded. Send stays disabled while an
  upload runs or has failed.
- **Success**:
  - the sent row contains the attachment card: an image is a button named after
    the file that opens a lightbox; a previewable file (text, Markdown, HTML,
    media, PDF) is a button "Preview <name>"; every card has
    `a[aria-label="Download"][href="/api/attachments/<id>?download"]`;
  - fetching that link from the signed-in browser returns 200 and the exact
    bytes; a user without access gets 404;
  - for Agent access, ask the Agent to reply with a marker that exists only in
    the file, and see the exact marker in its reply.
- **Limits**: at most 10 attachments per message (`MAX_ATTACHMENTS`), 10 MiB
  per file (`ATTACHMENT_MAX_BYTES` in
  `packages/coforge-sdk/src/internal/attachment-limits.ts`); larger uploads get
  413.
- **Traps**:
  - Keep the source file outside the Agent's workspace and put the marker only
    in the file, so the reply cannot come from the prompt or a stale file. A
    CLI defect once let an Agent read a stale `/tmp/read-me.txt`
    ([native HTTPS migration](../../../../docs/agents/e2e-testing/native-https-migration.md)).
  - Images and previewable types may redirect to a signed CDN URL; `?download`
    forces streaming.
  - The download link is icon-only; do not look for the file name in its text.
- **Covered by**: the attachment phase of `scripts/e2e/native-browser.e2e.ts`
  (uploads `read-me.txt`, asserts the Agent's exact reply and the 200 download;
  see [native browser scenario](../../../../docs/agents/e2e-testing/native-browser-scenario.md)).
  Its link-text assertion may be stale (see the note in
  [conversations](conversations.md#stale-selectors-in-older-harnesses)).
  Agent-originated uploads (`/api/agent/v1/attachment-upload-sessions`) and
  attachment comments have no browser coverage.
