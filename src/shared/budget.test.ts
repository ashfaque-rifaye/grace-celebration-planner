import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makePlan } from "../test/fixtures";
import {
  allocate,
  applyBudgetMove,
  buildBudgetLines,
  formatMoney,
  rebalanceLines,
  summarizeBudget,
} from "./budget";
import { EVENT_TYPES } from "./schemas";
import { EVENT_TEMPLATES } from "./templates";

describe("allocate", () => {
  it("always sums to exactly the total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const parts = allocate(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
          expect(parts.every((part) => part >= 0)).toBe(true);
        },
      ),
    );
  });

  it("splits evenly when every weight is zero", () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
  });

  it("handles no weights", () => {
    expect(allocate(100, [])).toEqual([]);
  });

  it("gives leftovers to the largest remainders", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});

describe("buildBudgetLines", () => {
  it.each(EVENT_TYPES)("sums to the total for a %s and holds back contingency", (eventType) => {
    const lines = buildBudgetLines({ eventType, budget: 123_457, priorities: [] });
    expect(lines.reduce((sum, line) => sum + line.allocated, 0)).toBe(123_457);
    expect(lines.find((line) => line.id === "contingency")?.allocated).toBe(12_346);
  });

  it("gives a priority category a bigger share", () => {
    const base = buildBudgetLines({ eventType: "wedding", budget: 1_000_000, priorities: [] });
    const boosted = buildBudgetLines({
      eventType: "wedding",
      budget: 1_000_000,
      priorities: ["photography"],
    });
    const photo = (lines: typeof base) =>
      lines.find((line) => line.id === "photography")?.allocated ?? 0;
    expect(photo(boosted)).toBeGreaterThan(photo(base));
    expect(boosted.reduce((sum, line) => sum + line.allocated, 0)).toBe(1_000_000);
  });

  it("uses template shares that sum to about one", () => {
    for (const type of EVENT_TYPES) {
      const sum = EVENT_TEMPLATES[type].budget.reduce((acc, line) => acc + line.share, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
});

describe("summarizeBudget", () => {
  it("counts only booked and paid vendor quotes as committed", () => {
    const plan = makePlan();
    const vendors = plan.vendors.map((vendor, index) => {
      if (index === 0) return { ...vendor, status: "quoted" as const, quote: 100_000 };
      if (index === 1) return { ...vendor, status: "booked" as const, quote: 200_000 };
      if (index === 2) return { ...vendor, status: "paid" as const, quote: 50_000 };
      return vendor;
    });
    expect(summarizeBudget({ ...plan, vendors }).committed).toBe(250_000);
  });

  it("adds hand-logged spend and flags an overspent line", () => {
    const plan = makePlan();
    const budgetLines = plan.budgetLines.map((line) =>
      line.id === "decor" ? { ...line, spent: line.allocated + 1 } : line,
    );
    const summary = summarizeBudget({ ...plan, budgetLines });
    const decor = summary.lines.find((line) => line.id === "decor");
    expect(decor?.over).toBe(true);
    expect(decor?.remaining).toBe(-1);
    expect(summary.over).toBe(false);
  });

  it("reports budget per guest and over-commitment", () => {
    const plan = makePlan({ budget: 1000, guests: 4 });
    const budgetLines = plan.budgetLines.map((line, index) =>
      index === 0 ? { ...line, spent: 5000 } : line,
    );
    const summary = summarizeBudget({ ...plan, budgetLines });
    expect(summary.perGuest).toBe(250);
    expect(summary.over).toBe(true);
    expect(summary.remaining).toBe(-4000);
    expect(summary.usedPercent).toBe(500);
  });

  it("does not divide by zero on an empty line", () => {
    const plan = makePlan();
    const budgetLines = plan.budgetLines.map((line) => ({ ...line, allocated: 0 }));
    expect(summarizeBudget({ ...plan, budgetLines }).lines[0]?.usedPercent).toBe(0);
  });
});

describe("rebalanceLines", () => {
  it("restores the total in proportion", () => {
    const lines = buildBudgetLines({ eventType: "birthday", budget: 50_000, priorities: [] });
    const rebalanced = rebalanceLines(lines, 100_000);
    expect(rebalanced.reduce((sum, line) => sum + line.allocated, 0)).toBe(100_000);
    expect(rebalanced[0]?.allocated).toBe((lines[0]?.allocated ?? 0) * 2);
  });
});

describe("applyBudgetMove", () => {
  const lines = buildBudgetLines({ eventType: "wedding", budget: 1_000_000, priorities: [] });
  const decor = lines.find((line) => line.id === "decor")?.allocated ?? 0;

  it("moves money and conserves the total", () => {
    const moved = applyBudgetMove(lines, { from: "decor", to: "catering", amount: 1000 });
    expect(moved?.find((line) => line.id === "decor")?.allocated).toBe(decor - 1000);
    expect(moved?.reduce((sum, line) => sum + line.allocated, 0)).toBe(1_000_000);
  });

  it.each([
    ["a hallucinated source", { from: "yacht", to: "catering", amount: 10 }],
    ["a hallucinated target", { from: "decor", to: "yacht", amount: 10 }],
    ["moving to itself", { from: "decor", to: "decor", amount: 10 }],
    ["more than the line holds", { from: "decor", to: "catering", amount: decor + 1 }],
    ["a zero amount", { from: "decor", to: "catering", amount: 0 }],
    ["a negative amount", { from: "decor", to: "catering", amount: -5 }],
  ])("rejects %s", (_name, move) => {
    expect(applyBudgetMove(lines, move)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("uses Indian digit grouping for rupees", () => {
    expect(formatMoney(1_500_000, "INR")).toBe("₹15,00,000");
  });

  it("formats other currencies and reuses formatters", () => {
    expect(formatMoney(1500, "USD")).toBe("$1,500");
    expect(formatMoney(2500, "USD")).toBe("$2,500");
  });
});
