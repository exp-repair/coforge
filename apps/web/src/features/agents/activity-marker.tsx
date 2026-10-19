import { statusToneClass } from "#src/components/ui/status-dot";
import { cn } from "#src/lib/utils";
import type { ActivityTone } from "./agent-activity-presentation";

/** A log row's marker size and offset, which centre it on the first line of `text-sm` text. The
 * error banner over the Activity tab hangs its marker the same way (`agent-error-banner.tsx`), so
 * the two cannot drift apart. */
export const ACTIVITY_MARKER_CLASS = "mt-[0.34375rem] size-[0.5625rem]";

/** The round marker an Activity row hangs on, in the row's tone. It never pulses: a log row is
 * a past event, not live status. Size and placement come from `className`. */
export function ActivityMarker({ tone, className }: { tone: ActivityTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-full border-[1.5px] border-fg-secondary",
        statusToneClass(tone),
        className,
      )}
    />
  );
}
