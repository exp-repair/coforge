import type { AgentRuntimeEvent } from "#src/code-agent/contract";
import { asRecord, eventTime } from "#src/code-agent/json-record";

/**
 * The runtime events one Claude Code `stream_event` record (`--include-partial-messages`)
 * reports. Text and thinking reach Activity once per completed content block, from the
 * `assistant` record Claude Code emits for that block (`message-events.ts`), so a partial
 * delta never carries text here: it only shows the turn is live. A text or thinking
 * `content_block_start` opens its run with an empty delta, so the trajectory announces
 * thinking or a model response at once rather than when the block completes.
 * Turn-state transitions (`message_start` starting a turn) stay with the session.
 * Stream events are main-session only; a record naming a parent tool call reports nothing.
 */
export function claudeStreamEvents(record: Readonly<Record<string, unknown>>): AgentRuntimeEvent[] {
  const event = asRecord(record.event);
  if (typeof event?.type !== "string" || record.parent_tool_use_id != null) return [];
  if (event.type === "content_block_start") {
    const blockType = asRecord(event.content_block)?.type;
    if (blockType === "text") return [{ type: "text-delta", text: "" }];
    if (blockType === "thinking") return [{ type: "thinking-delta", text: "" }];
  }
  return [{ type: "progress", source: "claude_stream_event", occurredAt: eventTime(record) }];
}
