import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { EVENT_TYPES } from "./schemas";
import { EVENT_TEMPLATES } from "./templates";
import {
  clampDate,
  compressDays,
  groupTasksByPhase,
  isCompressed,
  isOverdue,
  phaseFor,
  scheduleTasks,
  vendorBookBy,
} from "./timeline";

const TODAY = "2026-11-01";

describe("compressDays", () => {
  it("leaves the plan alone when there is enough runway", () => {
    expect(compressDays(100, 200, 300)).toBe(100);
  });

  it("scales proportionally when the runway is short", () => {
    expect(compressDays(100, 200, 50)).toBe(25);
  });

  it("collapses to the day itself when there is no runway", () => {
    expect(compressDays(100, 200, 0)).toBe(0);
    expect(compressDays(100, 200, -5)).toBe(0);
  });
});

describe("scheduleTasks", () => {
  const { tasks } = EVENT_TEMPLATES.wedding;

  it("uses the ideal dates when there is plenty of time", () => {
    const eventDate = addDays(TODAY, 400);
    const scheduled = scheduleTasks(tasks, TODAY, eventDate);
    expect(scheduled[0]?.due).toBe(addDays(eventDate, -270));
    expect(scheduled.at(-1)?.due).toBe(eventDate);
    expect(isCompressed(tasks, TODAY, eventDate)).toBe(false);
  });

  it("never schedules a task in the past, whatever the runway", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EVENT_TYPES),
        fc.integer({ min: 0, max: 800 }),
        (type, runway) => {
          const eventDate = addDays(TODAY, runway);
          const scheduled = scheduleTasks(EVENT_TEMPLATES[type].tasks, TODAY, eventDate);
          for (const task of scheduled) {
            expect(task.due >= TODAY).toBe(true);
            expect(task.due <= eventDate).toBe(true);
          }
        },
      ),
    );
  });

  it("keeps the template order when compressing", () => {
    const eventDate = addDays(TODAY, 30);
    const titles = scheduleTasks(tasks, TODAY, eventDate).map((task) => task.title);
    expect(titles[0]).toBe(tasks[0]?.title);
    expect(titles.at(-1)).toBe(tasks.at(-1)?.title);
    expect(isCompressed(tasks, TODAY, eventDate)).toBe(true);
  });

  it("copes with an event today", () => {
    const scheduled = scheduleTasks(tasks, TODAY, TODAY);
    expect(scheduled.every((task) => task.due === TODAY)).toBe(true);
  });

  it("copes with a past event date without crashing", () => {
    const past = addDays(TODAY, -5);
    expect(scheduleTasks(tasks, TODAY, past).every((task) => task.due === past)).toBe(true);
  });

  it("gives every task a unique id", () => {
    const scheduled = scheduleTasks(tasks, TODAY, addDays(TODAY, 300));
    expect(new Set(scheduled.map((task) => task.id)).size).toBe(tasks.length);
  });
});

describe("vendorBookBy", () => {
  const vendor = { label: "Venue", category: "venue", leadDays: 100 } as const;

  it("uses the lead time when there is room", () => {
    expect(vendorBookBy(vendor, 200, TODAY, addDays(TODAY, 300))).toBe(addDays(TODAY, 200));
  });

  it("compresses when time is short", () => {
    expect(vendorBookBy(vendor, 200, TODAY, addDays(TODAY, 100))).toBe(addDays(TODAY, 50));
  });
});

describe("phases", () => {
  const event = "2027-01-31";

  it.each([
    [90, "foundations"],
    [89, "bookings"],
    [30, "bookings"],
    [29, "details"],
    [7, "details"],
    [6, "final-week"],
    [1, "final-week"],
    [0, "the-day"],
  ])("%i days out is %s", (daysOut, phase) => {
    expect(phaseFor(addDays(event, -daysOut), event)).toBe(phase);
  });

  it("groups in chronological order and omits empty phases", () => {
    const task = (id: string, due: string) => ({
      id,
      title: id,
      due,
      done: false,
      source: "you" as const,
    });
    const groups = groupTasksByPhase(
      [task("late", event), task("early", addDays(event, -100)), task("mid", addDays(event, -10))],
      event,
    );
    expect(groups.map((group) => group.id)).toEqual(["foundations", "details", "the-day"]);
  });
});

describe("isOverdue", () => {
  it("is overdue only when open and before today", () => {
    expect(isOverdue({ due: "2026-10-31", done: false }, TODAY)).toBe(true);
    expect(isOverdue({ due: "2026-10-31", done: true }, TODAY)).toBe(false);
    expect(isOverdue({ due: TODAY, done: false }, TODAY)).toBe(false);
  });
});

describe("clampDate", () => {
  it("keeps dates inside the planning window", () => {
    expect(clampDate("2020-01-01", TODAY, "2027-01-01")).toBe(TODAY);
    expect(clampDate("2030-01-01", TODAY, "2027-01-01")).toBe("2027-01-01");
    expect(clampDate("2026-12-01", TODAY, "2027-01-01")).toBe("2026-12-01");
  });
});
