/**
 * Backward scheduling: turn "N days before the event" into real due dates.
 *
 * The important case is a short runway. A wedding template starts 270 days out,
 * so a wedding in six weeks cannot use those dates. Rather than leaving tasks
 * overdue on day one, the schedule compresses proportionally into the time that
 * remains, which preserves task order and tells the user it did so.
 */
import { addDays, daysBetween } from "./dates.js";
import type { Task } from "./schemas.js";
import type { TaskTemplate, VendorTemplate } from "./templates.js";

/** Map ideal days-before onto the runway that actually exists. */
export function compressDays(idealDays: number, maxIdealDays: number, runway: number): number {
  if (runway <= 0) return 0;
  if (maxIdealDays <= runway) return idealDays;
  return Math.round((idealDays / maxIdealDays) * runway);
}

export function isCompressed(
  templates: readonly { daysBefore: number }[],
  today: string,
  eventDate: string,
): boolean {
  const longest = Math.max(0, ...templates.map((t) => t.daysBefore));
  return longest > daysBetween(today, eventDate);
}

export function scheduleTasks(
  templates: readonly TaskTemplate[],
  today: string,
  eventDate: string,
): Task[] {
  const runway = Math.max(0, daysBetween(today, eventDate));
  const longest = Math.max(0, ...templates.map((t) => t.daysBefore));
  return templates
    .map((template, index): Task => ({
      id: `task-${index + 1}`,
      title: template.title,
      due: addDays(eventDate, -compressDays(template.daysBefore, longest, runway)),
      done: false,
      source: "template",
    }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

export function vendorBookBy(
  template: VendorTemplate,
  longestLead: number,
  today: string,
  eventDate: string,
): string {
  const runway = Math.max(0, daysBetween(today, eventDate));
  return addDays(eventDate, -compressDays(template.leadDays, longestLead, runway));
}

export const PHASES = [
  { id: "foundations", label: "Foundations", minDaysOut: 90 },
  { id: "bookings", label: "Bookings", minDaysOut: 30 },
  { id: "details", label: "Details", minDaysOut: 7 },
  { id: "final-week", label: "Final week", minDaysOut: 1 },
  { id: "the-day", label: "The day", minDaysOut: Number.NEGATIVE_INFINITY },
] as const;

export type PhaseId = (typeof PHASES)[number]["id"];

/** The phase a due date falls in, judged by its distance from the event. */
export function phaseFor(due: string, eventDate: string): PhaseId {
  const daysOut = daysBetween(due, eventDate);
  const phase = PHASES.find((p) => daysOut >= p.minDaysOut);
  return phase?.id ?? "the-day";
}

export interface TaskGroup {
  id: PhaseId;
  label: string;
  tasks: Task[];
}

/** Group tasks into chronological phases, omitting phases with nothing in them. */
export function groupTasksByPhase(tasks: readonly Task[], eventDate: string): TaskGroup[] {
  const sorted = [...tasks].sort((a, b) => a.due.localeCompare(b.due));
  return PHASES.map((phase) => ({
    id: phase.id,
    label: phase.label,
    tasks: sorted.filter((task) => phaseFor(task.due, eventDate) === phase.id),
  })).filter((group) => group.tasks.length > 0);
}

export function isOverdue(task: Pick<Task, "due" | "done">, today: string): boolean {
  return !task.done && task.due < today;
}

/** Keep a date inside the planning window, for dates suggested by the AI. */
export function clampDate(date: string, today: string, eventDate: string): string {
  if (date < today) return today;
  if (date > eventDate) return eventDate;
  return date;
}
