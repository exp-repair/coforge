import { codePointLength } from "./truncate";

/** The longest subagent type a lineage carries, in code points. */
export const ACTIVITY_SUBAGENT_TYPE_MAX = 40;
/** A subagent-scoped entry's lineage: the tool call that started the subagent, and the
 * provider's subagent type when it is known (single-line, at most
 * `ACTIVITY_SUBAGENT_TYPE_MAX` code points). */
export type ActivitySubagent = { parentToolUseId: string; subagentType?: string };
export type ActivityTrajectoryEntry = (
  | { kind: "text" | "thinking"; text: string }
  | { kind: "tool_start"; toolName: string; toolInput?: string }
  | { kind: "system"; title: string; text: string }
) & { subagent?: ActivitySubagent };

// Eight entries permit bounded batching (at most ~64KiB of UTF-8 text).
export function parseActivityEntries(value: unknown): ActivityTrajectoryEntry[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("invalid activity entries");
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("invalid activity entry");
    const item = entry as Record<string, unknown>;
    let subagent: ActivitySubagent | undefined;
    if (item.subagent !== undefined) {
      const lineage = item.subagent as Record<string, unknown> | null;
      if (
        !lineage ||
        !validLine(lineage.parentToolUseId, 128) ||
        (lineage.subagentType !== undefined &&
          !validLine(lineage.subagentType, ACTIVITY_SUBAGENT_TYPE_MAX))
      )
        throw new Error("invalid activity lineage");
      subagent = {
        parentToolUseId: lineage.parentToolUseId,
        ...(lineage.subagentType !== undefined ? { subagentType: lineage.subagentType } : {}),
      };
    }
    const scope = subagent ? { subagent } : {};
    if (
      item.kind === "tool_start" &&
      validLine(item.toolName, 128) &&
      item.text === undefined &&
      item.title === undefined &&
      (item.toolInput === undefined || validToolInput(item.toolInput))
    )
      return {
        kind: "tool_start",
        toolName: item.toolName,
        ...(item.toolInput !== undefined ? { toolInput: item.toolInput as string } : {}),
        ...scope,
      };
    if (
      (item.kind === "text" || item.kind === "thinking") &&
      typeof item.text === "string" &&
      codePointLength(item.text) <= 2000 &&
      item.toolName === undefined &&
      item.toolInput === undefined &&
      item.title === undefined
    )
      return { kind: item.kind, text: item.text, ...scope };
    if (
      item.kind === "system" &&
      validLine(item.title, 120) &&
      typeof item.text === "string" &&
      codePointLength(item.text) <= 2000 &&
      item.toolName === undefined &&
      item.toolInput === undefined
    )
      return { kind: "system", title: item.title, text: item.text, ...scope };
    throw new Error("invalid activity entry payload");
  });
}

/** A non-empty single-line string of at most `maxCodePoints` code points. */
function validLine(value: unknown, maxCodePoints: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    codePointLength(value) <= maxCodePoints &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

// `toolInput`: the short, already-redacted argument summary. Same
// control-character rejection as `validLine`, but it may be empty.
function validToolInput(value: unknown): value is string {
  return (
    typeof value === "string" && codePointLength(value) <= 200 && !/[\x00-\x1f\x7f]/.test(value)
  );
}
