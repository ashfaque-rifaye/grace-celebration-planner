import { describe, expect, it } from "vitest";
import { makePlan, TODAY } from "../test/fixtures";
import {
  computeReadiness,
  countdownLabel,
  countdownParts,
  daysToGo,
  detectRisks,
  isVendorSecured,
  nextActions,
} from "./insights";
import { buildPlanContext } from "./plan-context";
import { planContextSchema } from "./contracts";
import type { Plan } from "./schemas";

function finishEverything(plan: Plan): Plan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({ ...task, done: true })),
    vendors: plan.vendors.map((vendor) => ({ ...vendor, status: "paid" as const })),
  };
}

describe("computeReadiness", () => {
  it("starts with only the budget marks on a fresh plan", () => {
    const readiness = computeReadiness(makePlan());
    expect(readiness.score).toBe(25);
    expect(readiness.tasksDone).toBe(0);
    expect(readiness.vendorsBooked).toBe(0);
  });

  it("reaches 100 when everything is done", () => {
    expect(computeReadiness(finishEverything(makePlan())).score).toBe(100);
  });

  it("loses budget marks in proportion to overspend", () => {
    const plan = makePlan({ budget: 1000 });
    const budgetLines = plan.budgetLines.map((line, index) =>
      index === 0 ? { ...line, spent: 1500 } : line,
    );
    expect(computeReadiness({ ...plan, budgetLines }).budgetPart).toBeCloseTo(0.5);
    const wild = plan.budgetLines.map((line, index) =>
      index === 0 ? { ...line, spent: 50_000 } : line,
    );
    expect(computeReadiness({ ...plan, budgetLines: wild }).budgetPart).toBe(0);
  });

  it("does not divide by zero on an empty plan", () => {
    const plan = { ...makePlan(), tasks: [], vendors: [] };
    expect(computeReadiness(plan).score).toBe(100);
  });
});

describe("detectRisks", () => {
  it("is quiet on a healthy new plan", () => {
    expect(detectRisks(makePlan(), TODAY)).toEqual([]);
  });

  it("escalates overdue tasks from watch to high at three", () => {
    const later = "2027-06-01";
    const plan = makePlan();
    const one = detectRisks(plan, plan.tasks[0]?.due ?? later);
    expect(one).toEqual([]);

    const overdue = (count: number): Plan => ({
      ...plan,
      vendors: [],
      tasks: plan.tasks.map((task, index) =>
        index < count ? { ...task, due: "2026-10-01" } : { ...task, due: later },
      ),
    });
    expect(detectRisks(overdue(1), TODAY)[0]).toMatchObject({
      id: "tasks-overdue",
      severity: "medium",
      title: "1 overdue task",
    });
    expect(detectRisks(overdue(3), TODAY)[0]).toMatchObject({
      severity: "high",
      title: "3 overdue tasks",
    });
  });

  it("flags vendors past their book-by date", () => {
    const plan = makePlan();
    const vendors = plan.vendors.map((vendor, index) =>
      index === 0 ? { ...vendor, bookBy: "2026-10-01" } : vendor,
    );
    const risk = detectRisks({ ...plan, vendors }, TODAY).find((r) => r.id === "vendors-late");
    expect(risk?.severity).toBe("high");
    expect(risk?.title).toBe("1 vendor past the book-by date");
  });

  it("does not flag a booked vendor as late", () => {
    const plan = makePlan();
    const vendors = plan.vendors.map((vendor) => ({
      ...vendor,
      bookBy: "2026-10-01",
      status: "booked" as const,
    }));
    expect(detectRisks({ ...plan, vendors }, TODAY)).toEqual([]);
  });

  it("flags over-commitment, with the total taking priority over line overages", () => {
    const plan = makePlan({ budget: 1000 });
    const budgetLines = plan.budgetLines.map((line, index) =>
      index === 0 ? { ...line, spent: 5000 } : line,
    );
    const ids = detectRisks({ ...plan, budgetLines }, TODAY).map((risk) => risk.id);
    expect(ids).toContain("budget-over");
    expect(ids).not.toContain("lines-over");
  });

  it("flags a single overspent line when the total is still fine", () => {
    const plan = makePlan();
    const budgetLines = plan.budgetLines.map((line) =>
      line.id === "decor" ? { ...line, spent: line.allocated + 100 } : line,
    );
    const [risk] = detectRisks({ ...plan, budgetLines }, TODAY);
    expect(risk).toMatchObject({ id: "lines-over", severity: "medium" });
    expect(risk?.why).toContain("Decor & florals");
  });

  it("flags lines that add up to more than the total", () => {
    const plan = makePlan();
    const budgetLines = plan.budgetLines.map((line) =>
      line.id === "decor" ? { ...line, allocated: line.allocated + 500 } : line,
    );
    const [risk] = detectRisks({ ...plan, budgetLines }, TODAY);
    expect(risk?.id).toBe("budget-overallocated");
  });

  it("sorts high severity first", () => {
    const plan = makePlan();
    const risky: Plan = {
      ...plan,
      tasks: plan.tasks.map((task, index) => (index === 0 ? { ...task, due: "2026-10-01" } : task)),
      vendors: plan.vendors.map((vendor, index) =>
        index === 0 ? { ...vendor, bookBy: "2026-10-01" } : vendor,
      ),
    };
    expect(detectRisks(risky, TODAY)[0]?.severity).toBe("high");
  });
});

describe("nextActions", () => {
  it("merges tasks and vendors by due date and honours the limit", () => {
    const actions = nextActions(makePlan(), TODAY, 4);
    expect(actions).toHaveLength(4);
    const dues = actions.map((action) => action.due);
    expect([...dues].sort()).toEqual(dues);
    expect(new Set(nextActions(makePlan(), TODAY, 30).map((a) => a.kind))).toEqual(
      new Set(["task", "vendor"]),
    );
  });

  it("skips finished work and marks overdue items", () => {
    const plan = makePlan();
    const tasks = plan.tasks.map((task, index) =>
      index === 0 ? { ...task, due: "2026-10-01" } : { ...task, done: true },
    );
    const vendors = plan.vendors.map((vendor) => ({ ...vendor, status: "paid" as const }));
    const actions = nextActions({ ...plan, tasks, vendors }, TODAY);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.overdue).toBe(true);
    expect(nextActions(finishEverything(plan), TODAY)).toEqual([]);
  });
});

describe("helpers", () => {
  it("knows which vendors are secured", () => {
    expect(isVendorSecured({ status: "booked" })).toBe(true);
    expect(isVendorSecured({ status: "paid" })).toBe(true);
    expect(isVendorSecured({ status: "quoted" })).toBe(false);
  });

  it("counts down in natural language", () => {
    expect(countdownParts(9)).toEqual({ value: "9", unit: "days to go" });
    expect(countdownParts(1)).toEqual({ value: "Tomorrow", unit: "" });
    expect(countdownParts(0)).toEqual({ value: "Today", unit: "" });
    expect(countdownLabel(-1)).toBe("1 day ago");
    expect(countdownLabel(-5)).toBe("5 days ago");
    expect(countdownLabel(0)).toBe("Today");
    expect(countdownLabel(1)).toBe("Tomorrow");
    expect(countdownLabel(9)).toBe("9 days to go");
    expect(daysToGo(makePlan({ date: "2026-11-11" }), TODAY)).toBe(10);
  });
});

describe("buildPlanContext (the privacy boundary)", () => {
  it("never sends vendor contact details or notes to the AI", () => {
    const plan = makePlan();
    const vendors = plan.vendors.map((vendor) => ({
      ...vendor,
      contact: "meena@secret-example.com +91 98765 43210",
      notes: "PRIVATE-NOTE",
    }));
    const serialised = JSON.stringify(buildPlanContext({ ...plan, vendors }, TODAY));
    expect(serialised).not.toContain("secret-example");
    expect(serialised).not.toContain("98765");
    expect(serialised).not.toContain("PRIVATE-NOTE");
  });

  it("satisfies the wire contract", () => {
    expect(planContextSchema.safeParse(buildPlanContext(makePlan(), TODAY)).success).toBe(true);
  });

  it("caps the open tasks and sorts them by urgency", () => {
    const context = buildPlanContext(makePlan(), TODAY);
    expect(context.openTasks.length).toBeLessThanOrEqual(15);
    const dues = context.openTasks.map((task) => task.due);
    expect([...dues].sort()).toEqual(dues);
  });
});
