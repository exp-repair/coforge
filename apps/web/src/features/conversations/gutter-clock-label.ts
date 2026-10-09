import { dateTimeFormat } from "#src/lib/dates";
import { hour12For, type TimeFormat } from "#src/lib/time-format";

/**
 * The time of day without its AM/PM marker ("2:50"), short enough for the avatar-wide gutter beside
 * a grouped message; the sender's heading above carries the full `clockLabel`. Empty without a
 * `locale`.
 */
export function gutterClockLabel(
  value: Date | string,
  locale?: string,
  timeFormat: TimeFormat | null = null,
  timeZone?: string,
): string {
  if (!locale) return "";
  return dateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: hour12For(timeFormat),
    timeZone,
  })
    .formatToParts(new Date(value))
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}
