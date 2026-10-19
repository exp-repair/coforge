import { describe, expect, test } from "bun:test";
import { claudeStreamEvents } from "#src/code-agent/claude-code/stream-events";

const timestamp = "2026-10-11T10:00:00.000Z";
const streamEvent = (event: unknown, parentToolUseId: string | null = null) => ({
  type: "stream_event",
  parent_tool_use_id: parentToolUseId,
  timestamp,
  event,
});
const delta = (value: Record<string, unknown>) => ({ type: "content_block_delta", delta: value });
const progress = {
  type: "progress",
  source: "claude_stream_event",
  occurredAt: timestamp,
} as const;

describe("claudeStreamEvents", () => {
  // Text and thinking reach Activity once per completed content block, from the `assistant`
  // record (message-events.ts). A delta only shows the turn is live, so no text is shown twice.
  test("reports a text or thinking delta as progress, without its text", () => {
    expect(claudeStreamEvents(streamEvent(delta({ type: "text_delta", text: "Hi" })))).toEqual([
      progress,
    ]);
    expect(
      claudeStreamEvents(streamEvent(delta({ type: "thinking_delta", thinking: "Hmm" }))),
    ).toEqual([progress]);
  });

  test("opens a text or thinking run, with no text, when its content block starts", () => {
    expect(
      claudeStreamEvents(
        streamEvent({ type: "content_block_start", content_block: { type: "text", text: "" } }),
      ),
    ).toEqual([{ type: "text-delta", text: "" }]);
    expect(
      claudeStreamEvents(
        streamEvent({
          type: "content_block_start",
          content_block: { type: "thinking", thinking: "" },
        }),
      ),
    ).toEqual([{ type: "thinking-delta", text: "" }]);
  });

  test("reports any other top-level stream event as progress", () => {
    expect(claudeStreamEvents(streamEvent({ type: "message_start" }))).toEqual([progress]);
    expect(claudeStreamEvents(streamEvent(delta({ type: "input_json_delta" })))).toEqual([
      progress,
    ]);
    expect(
      claudeStreamEvents(
        streamEvent({ type: "content_block_start", content_block: { type: "tool_use" } }),
      ),
    ).toEqual([progress]);
    expect(claudeStreamEvents(streamEvent({ type: "content_block_stop" }))).toEqual([progress]);
  });

  test("reports nothing for a subagent's stream event or an event without a type", () => {
    expect(claudeStreamEvents(streamEvent({ type: "message_start" }, "toolu_1"))).toEqual([]);
    expect(
      claudeStreamEvents(streamEvent(delta({ type: "text_delta", text: "Hi" }), "toolu_1")),
    ).toEqual([]);
    expect(claudeStreamEvents(streamEvent({}))).toEqual([]);
    expect(claudeStreamEvents(streamEvent(undefined))).toEqual([]);
  });
});
