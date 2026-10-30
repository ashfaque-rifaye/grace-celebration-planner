/**
 * Take the plan elsewhere: calendar (.ics) and spreadsheet (.csv) exports.
 *
 * Both formats are injection surfaces when they contain user or model text, so
 * this module escapes them properly rather than joining strings. Pure, returning
 * text that the UI turns into a download.
 */
import { addDays } from "./dates.js";
import { summarizeBudget } from "./budget.js";
import type { Plan } from "./schemas.js";

/** RFC 5545 text escaping. */
function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

/** RFC 5545 requires lines of at most 75 octets, folded with a leading space. */
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (size + width > 73) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** An all-day calendar entry per open task, plus one for the event itself. */
export function planToIcs(plan: Plan, stamp: string): string {
  const dtstamp = `${stamp.replace(/[-:]/g, "").slice(0, 15)}Z`;
  const event = (uid: string, date: string, summary: string, description?: string): string[] => [
    "BEGIN:VEVENT",
    `UID:${uid}@grace.planner`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${icsDate(date)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(date, 1))}`,
    `SUMMARY:${icsText(summary)}`,
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    "END:VEVENT",
  ];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Grace//Celebration Planner//EN",
    "CALSCALE:GREGORIAN",
    ...event(`${plan.id}-event`, plan.brief.date, plan.brief.title),
    ...plan.tasks
      .filter((task) => !task.done)
      .flatMap((task) =>
        event(`${plan.id}-${task.id}`, task.due, task.title, `For: ${plan.brief.title}`),
      ),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/**
 * Quote a CSV cell and defuse spreadsheet formula injection: a cell beginning
 * with = + - or @ would run as a formula when opened in Excel or Sheets.
 */
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function budgetToCsv(plan: Plan): string {
  const summary = summarizeBudget(plan);
  const rows: (string | number)[][] = [
    ["Category", "Allocated", "Committed", "Remaining", `Currency: ${plan.brief.currency}`],
    ...summary.lines.map((line) => [
      line.label,
      line.allocated,
      line.committed,
      line.remaining,
      line.over ? "Over budget" : "",
    ]),
    ["Total", summary.allocated, summary.committed, summary.remaining, ""],
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function planToJson(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}
