import { expect, test } from "bun:test";

import { ACTIVITY_SUBAGENT_TYPE_MAX, parseActivityEntries } from "./activity-entries";

test("parses a tool_start entry without toolInput", () => {
  expect(parseActivityEntries([{ kind: "tool_start", toolName: "bash" }])).toEqual([
    { kind: "tool_start", toolName: "bash" },
  ]);
});

test("parses a tool_start entry with toolInput", () => {
  expect(
    parseActivityEntries([{ kind: "tool_start", toolName: "bash", toolInput: "ls -la /tmp" }]),
  ).toEqual([{ kind: "tool_start", toolName: "bash", toolInput: "ls -la /tmp" }]);
});

test("accepts a toolInput at the 200-character cap", () => {
  const toolInput = "a".repeat(200);
  expect(parseActivityEntries([{ kind: "tool_start", toolName: "bash", toolInput }])).toEqual([
    { kind: "tool_start", toolName: "bash", toolInput },
  ]);
});

test("rejects a toolInput over the 200-character cap", () => {
  const toolInput = "a".repeat(201);
  expect(() => parseActivityEntries([{ kind: "tool_start", toolName: "bash", toolInput }])).toThrow(
    "invalid activity entry payload",
  );
});

test("rejects a toolInput carrying a control character", () => {
  expect(() =>
    parseActivityEntries([{ kind: "tool_start", toolName: "bash", toolInput: "ls\x00/tmp" }]),
  ).toThrow("invalid activity entry payload");
});

test("parses a system entry", () => {
  expect(
    parseActivityEntries([
      { kind: "system", title: "Session reset", text: "New session started." },
    ]),
  ).toEqual([{ kind: "system", title: "Session reset", text: "New session started." }]);
});

test("accepts a system entry title at the 120-character cap and text at the 2000-character cap", () => {
  const title = "t".repeat(120);
  const text = "x".repeat(2000);
  expect(parseActivityEntries([{ kind: "system", title, text }])).toEqual([
    { kind: "system", title, text },
  ]);
});

test("rejects a system entry title over the 120-character cap", () => {
  const title = "t".repeat(121);
  expect(() => parseActivityEntries([{ kind: "system", title, text: "body" }])).toThrow(
    "invalid activity entry payload",
  );
});

test("rejects a system entry text over the 2000-character cap", () => {
  const text = "x".repeat(2001);
  expect(() => parseActivityEntries([{ kind: "system", title: "t", text }])).toThrow(
    "invalid activity entry payload",
  );
});

test("rejects a system entry with an empty title", () => {
  expect(() => parseActivityEntries([{ kind: "system", title: "", text: "body" }])).toThrow(
    "invalid activity entry payload",
  );
});

test("rejects a system entry title carrying a control character", () => {
  expect(() =>
    parseActivityEntries([{ kind: "system", title: "bad\x01title", text: "body" }]),
  ).toThrow("invalid activity entry payload");
});

test("rejects a system entry missing text", () => {
  expect(() => parseActivityEntries([{ kind: "system", title: "t" }])).toThrow(
    "invalid activity entry payload",
  );
});

test("preserves subagent scope on a system entry", () => {
  expect(
    parseActivityEntries([
      {
        kind: "system",
        title: "t",
        text: "body",
        subagent: { parentToolUseId: "tool-1" },
      },
    ]),
  ).toEqual([
    { kind: "system", title: "t", text: "body", subagent: { parentToolUseId: "tool-1" } },
  ]);
});

test("preserves a subagent lineage's subagentType", () => {
  expect(
    parseActivityEntries([
      {
        kind: "tool_start",
        toolName: "read_file",
        subagent: { parentToolUseId: "tool-1", subagentType: "Explore" },
      },
    ]),
  ).toEqual([
    {
      kind: "tool_start",
      toolName: "read_file",
      subagent: { parentToolUseId: "tool-1", subagentType: "Explore" },
    },
  ]);
});

test("rejects a subagentType that is empty, too long, multi-line, or not a string", () => {
  const longest = "x".repeat(ACTIVITY_SUBAGENT_TYPE_MAX);
  expect(
    parseActivityEntries([
      { kind: "text", text: "a", subagent: { parentToolUseId: "tool-1", subagentType: longest } },
    ]),
  ).toEqual([
    { kind: "text", text: "a", subagent: { parentToolUseId: "tool-1", subagentType: longest } },
  ]);
  for (const subagentType of ["", `${longest}x`, "Ex\nplore", 7])
    expect(() =>
      parseActivityEntries([
        { kind: "text", text: "a", subagent: { parentToolUseId: "tool-1", subagentType } },
      ]),
    ).toThrow("invalid activity lineage");
});
