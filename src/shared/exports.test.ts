import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makePlan } from "../test/fixtures.js";
import { budgetToCsv, csvCell, planToIcs, planToJson } from "./exports.js";
import { planSchema } from "./schemas.js";

const STAMP = "2026-11-01T10:00:00.000Z";

describe("planToIcs", () => {
  it("produces a valid calendar with the event and each open task", () => {
    const plan = makePlan();
    const ics = planToIcs(plan, STAMP);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(plan.tasks.length + 1);
    expect(ics).toContain("DTSTART;VALUE=DATE:20270815");
    expect(ics).toContain("DTEND;VALUE=DATE:20270816");
    expect(ics).toContain("DTSTAMP:20261101T100000Z");
  });

  it("leaves out finished tasks", () => {
    const plan = makePlan();
    const tasks = plan.tasks.map((task) => ({ ...task, done: true }));
    expect(planToIcs({ ...plan, tasks }, STAMP).match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("escapes text so user input cannot inject calendar properties", () => {
    const plan = makePlan({ title: "A, B; C\\D\nATTENDEE:evil@example.com" });
    const ics = planToIcs(plan, STAMP).replace(/\r\n /g, "");
    expect(ics).toContain("SUMMARY:A\\, B\\; C\\\\D\\nATTENDEE:evil@example.com");
    expect(ics).not.toMatch(/^ATTENDEE:/m);
  });

  it("folds long lines at 75 octets, including multi-byte text", () => {
    const plan = makePlan({ title: "வ".repeat(70) });
    const ics = planToIcs(plan, STAMP);
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics.replace(/\r\n /g, "")).toContain("வ".repeat(70));
  });
});

describe("csvCell", () => {
  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+1234", "'+1234"],
    ["-1234", "'-1234"],
    ["@cmd", "'@cmd"],
    ["\tleading tab", "'\tleading tab"],
  ])("defuses the formula %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("leaves numbers, including negatives, as real numbers", () => {
    expect(csvCell(-500)).toBe("-500");
    expect(csvCell(1200)).toBe("1200");
  });

  it("never lets a string start a formula, whatever its contents", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(csvCell(text).replace(/^"/, "")).not.toMatch(/^[=+\-@]/);
      }),
    );
  });
});

describe("budgetToCsv", () => {
  it("has a header, one row per line, and a total", () => {
    const plan = makePlan();
    const rows = budgetToCsv(plan).trim().split("\r\n");
    expect(rows).toHaveLength(plan.budgetLines.length + 2);
    expect(rows[0]).toContain("Currency: INR");
    expect(rows.at(-1)).toMatch(/^Total,1500000,0,1500000,/);
  });

  it("marks overspent lines in words", () => {
    const plan = makePlan();
    const budgetLines = plan.budgetLines.map((line) =>
      line.id === "decor" ? { ...line, spent: line.allocated + 1 } : line,
    );
    expect(budgetToCsv({ ...plan, budgetLines })).toContain("Over budget");
  });
});

describe("planToJson", () => {
  it("round-trips through the schema", () => {
    const plan = makePlan();
    expect(planSchema.parse(JSON.parse(planToJson(plan)))).toEqual(plan);
  });
});
