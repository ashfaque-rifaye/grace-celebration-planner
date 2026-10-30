import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, daysBetween, formatDate, isIsoDate, todayIso } from "./dates";

describe("isIsoDate", () => {
  it.each(["2026-01-31", "2028-02-29", "2026-12-01"])("accepts %s", (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each(["2026-02-31", "2027-02-29", "2026-13-01", "26-1-1", "", "not a date", "2026-1-01"])(
    "rejects %s",
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );
});

describe("date arithmetic", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("counts days in both directions", () => {
    expect(daysBetween("2026-11-01", "2026-11-11")).toBe(10);
    expect(daysBetween("2026-11-11", "2026-11-01")).toBe(-10);
    expect(daysBetween("2026-11-01", "2026-11-01")).toBe(0);
  });

  it("is stable across a DST change", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("addDays and daysBetween are inverses", () => {
    fc.assert(
      fc.property(fc.integer({ min: -5000, max: 5000 }), (offset) => {
        expect(daysBetween("2026-06-15", addDays("2026-06-15", offset))).toBe(offset);
      }),
    );
  });
});

describe("formatting", () => {
  it("uses the local calendar day for today", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("formats an ISO date for people", () => {
    expect(formatDate("2026-11-30")).toBe("30 Nov 2026");
  });
});
