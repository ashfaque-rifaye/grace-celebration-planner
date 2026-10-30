import { describe, expect, it } from "vitest";
import { makeBrief, makePlan, TODAY } from "../test/fixtures.js";
import { planReducer, type PlanAction } from "./plan.js";
import { planSchema, EVENT_TYPES, type Plan } from "./schemas.js";

const apply = (plan: Plan, action: PlanAction) => planReducer(plan, action, TODAY);

describe("createPlan", () => {
  it.each(EVENT_TYPES)("builds a schema-valid plan for a %s", (eventType) => {
    const plan = makePlan({ eventType, priorities: [] });
    expect(planSchema.safeParse(plan).success).toBe(true);
    expect(plan.tasks.length).toBeGreaterThan(5);
    expect(plan.vendors.length).toBeGreaterThan(3);
    expect(plan.budgetLines.length).toBeGreaterThan(5);
  });

  it("schedules every vendor on or before the event", () => {
    const plan = makePlan({ date: "2026-12-01" });
    expect(plan.vendors.every((v) => v.bookBy >= TODAY && v.bookBy <= "2026-12-01")).toBe(true);
  });
});

describe("tasks", () => {
  it("toggles a task and back", () => {
    const plan = makePlan();
    const id = plan.tasks[0]?.id ?? "";
    const done = apply(plan, { type: "toggleTask", id });
    expect(done.tasks[0]?.done).toBe(true);
    expect(apply(done, { type: "toggleTask", id }).tasks[0]?.done).toBe(false);
  });

  it("mints unique ids without randomness", () => {
    let plan = makePlan();
    plan = apply(plan, { type: "addTask", title: "One", due: TODAY });
    plan = apply(plan, { type: "addTask", title: "Two", due: TODAY });
    const ids = plan.tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.seq).toBe(2);
  });

  it("ignores a blank title", () => {
    const plan = makePlan();
    expect(apply(plan, { type: "addTask", title: "   ", due: TODAY })).toBe(plan);
  });

  it("pulls an out-of-window due date back inside the plan", () => {
    const plan = apply(makePlan(), { type: "addTask", title: "Late", due: "2099-01-01" });
    expect(plan.tasks.at(-1)?.due).toBe(plan.brief.date);
    const early = apply(makePlan(), { type: "addTask", title: "Early", due: "2000-01-01" });
    expect(early.tasks.at(-1)?.due).toBe(TODAY);
  });

  it("removes a task", () => {
    const plan = makePlan();
    const id = plan.tasks[0]?.id ?? "";
    expect(apply(plan, { type: "removeTask", id }).tasks.some((t) => t.id === id)).toBe(false);
  });
});

describe("budget actions", () => {
  it("sets allocated and spent amounts, rounding to whole units", () => {
    const plan = makePlan();
    const allocated = apply(plan, { type: "setLineAllocated", id: "decor", amount: 1000.4 });
    expect(allocated.budgetLines.find((l) => l.id === "decor")?.allocated).toBe(1000);
    const spent = apply(plan, { type: "setLineSpent", id: "decor", amount: 99.6 });
    expect(spent.budgetLines.find((l) => l.id === "decor")?.spent).toBe(100);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects the amount %s", (amount) => {
    const plan = makePlan();
    expect(apply(plan, { type: "setLineAllocated", id: "decor", amount })).toBe(plan);
    expect(apply(plan, { type: "setLineSpent", id: "decor", amount })).toBe(plan);
    expect(apply(plan, { type: "setTotalBudget", amount })).toBe(plan);
  });

  it("rejects a zero total, which would make every share meaningless", () => {
    const plan = makePlan();
    expect(apply(plan, { type: "setTotalBudget", amount: 0 })).toBe(plan);
  });

  it("rescales every line when the total changes", () => {
    const plan = apply(makePlan(), { type: "setTotalBudget", amount: 3_000_000 });
    expect(plan.brief.budget).toBe(3_000_000);
    expect(plan.budgetLines.reduce((sum, line) => sum + line.allocated, 0)).toBe(3_000_000);
  });

  it("rebalances lines back to the total after manual edits", () => {
    const edited = apply(makePlan(), { type: "setLineAllocated", id: "decor", amount: 9_000_000 });
    const plan = apply(edited, { type: "rebalanceBudget" });
    expect(plan.budgetLines.reduce((sum, line) => sum + line.allocated, 0)).toBe(1_500_000);
  });

  it("applies a valid move and ignores an impossible one", () => {
    const plan = makePlan();
    const moved = apply(plan, { type: "moveBudget", from: "decor", to: "catering", amount: 100 });
    expect(moved.budgetLines).not.toEqual(plan.budgetLines);
    expect(apply(plan, { type: "moveBudget", from: "nope", to: "catering", amount: 100 })).toBe(
      plan,
    );
  });

  it("stores a budget review", () => {
    const review = { advice: [], moves: [], reasoning: "r", source: "fallback" as const };
    expect(apply(makePlan(), { type: "setBudgetReview", review }).budgetReview).toEqual(review);
  });
});

describe("vendors", () => {
  it("patches a vendor", () => {
    const plan = makePlan();
    const id = plan.vendors[0]?.id ?? "";
    const updated = apply(plan, {
      type: "updateVendor",
      id,
      patch: { status: "booked", quote: 5000, contact: "Meena" },
    });
    expect(updated.vendors[0]).toMatchObject({ status: "booked", quote: 5000, contact: "Meena" });
  });

  it("adds a vendor due now and removes it again", () => {
    const added = apply(makePlan(), { type: "addVendor", label: " Mehendi artist " });
    const vendor = added.vendors.at(-1);
    expect(vendor).toMatchObject({ label: "Mehendi artist", bookBy: TODAY, source: "you" });
    const removed = apply(added, { type: "removeVendor", id: vendor?.id ?? "" });
    expect(removed.vendors.some((v) => v.id === vendor?.id)).toBe(false);
  });

  it("ignores a blank vendor label", () => {
    const plan = makePlan();
    expect(apply(plan, { type: "addVendor", label: "  " })).toBe(plan);
  });

  it("stores a vendor brief", () => {
    const plan = makePlan();
    const id = plan.vendors[1]?.id ?? "";
    const brief = { questions: ["Q?"], redFlags: [], negotiationTip: "T", reasoning: "R" };
    expect(apply(plan, { type: "setVendorBrief", id, brief }).vendors[1]?.brief).toEqual(brief);
  });
});

describe("ideas", () => {
  const idea = { title: "A", description: "D", category: "Food", estimatedCost: 10, why: "W" };

  it("keeps saved ideas through a regenerate and replaces the rest", () => {
    let plan = apply(makePlan(), { type: "setIdeas", ideas: [idea, { ...idea, title: "B" }] });
    const firstId = plan.ideas[0]?.id ?? "";
    plan = apply(plan, { type: "toggleIdeaSaved", id: firstId });
    plan = apply(plan, { type: "setIdeas", ideas: [{ ...idea, title: "C" }] });
    expect(plan.ideas.map((i) => i.title)).toEqual(["A", "C"]);
    expect(new Set(plan.ideas.map((i) => i.id)).size).toBe(2);
  });
});

describe("run sheet", () => {
  it("replaces the run sheet", () => {
    const items = [{ time: "10:00", title: "Open", owner: "Host" }];
    expect(apply(makePlan(), { type: "setRunSheet", items }).runSheet).toEqual(items);
  });
});

describe("assistant proposals", () => {
  function withProposals(): Plan {
    return apply(makePlan(), {
      type: "appendChat",
      message: {
        role: "assistant",
        text: "Try these",
        proposals: [
          { type: "addTask", title: "Check weather", due: "2027-08-01", why: "Rain risk" },
          { type: "addVendor", label: "Tent hire", why: "Backup" },
          { type: "moveBudget", from: "decor", to: "catering", amount: 500, why: "Food first" },
          { type: "moveBudget", from: "yacht", to: "catering", amount: 500, why: "Bad id" },
        ],
      },
    });
  }

  it("changes nothing until a proposal is approved", () => {
    const plan = withProposals();
    expect(plan.tasks.some((task) => task.title === "Check weather")).toBe(false);
    expect(plan.chat[0]?.proposals).toHaveLength(4);
  });

  it("applies an approved task as AI-sourced, then removes the proposal", () => {
    const plan = withProposals();
    const messageId = plan.chat[0]?.id ?? "";
    const next = apply(plan, { type: "applyProposal", messageId, index: 0 });
    expect(next.tasks.at(-1)).toMatchObject({ title: "Check weather", source: "ai" });
    expect(next.chat[0]?.proposals).toHaveLength(3);
  });

  it("applies an approved vendor and budget move", () => {
    let plan = withProposals();
    const messageId = plan.chat[0]?.id ?? "";
    const before = plan.budgetLines.find((line) => line.id === "catering")?.allocated ?? 0;
    plan = apply(plan, { type: "applyProposal", messageId, index: 1 });
    expect(plan.vendors.at(-1)?.label).toBe("Tent hire");
    plan = apply(plan, { type: "applyProposal", messageId, index: 1 });
    expect(plan.budgetLines.find((line) => line.id === "catering")?.allocated).toBe(before + 500);
  });

  it("treats a move with a hallucinated line as a no-op on the budget", () => {
    const plan = withProposals();
    const messageId = plan.chat[0]?.id ?? "";
    const next = apply(plan, { type: "applyProposal", messageId, index: 3 });
    expect(next.budgetLines).toEqual(plan.budgetLines);
    expect(next.chat[0]?.proposals).toHaveLength(3);
  });

  it("dismisses without applying", () => {
    const plan = withProposals();
    const messageId = plan.chat[0]?.id ?? "";
    const next = apply(plan, { type: "dismissProposal", messageId, index: 0 });
    expect(next.tasks).toEqual(plan.tasks);
    expect(next.chat[0]?.proposals).toHaveLength(3);
  });

  it("ignores a stale proposal reference", () => {
    const plan = withProposals();
    expect(apply(plan, { type: "applyProposal", messageId: "gone", index: 0 })).toBe(plan);
    expect(
      apply(plan, { type: "applyProposal", messageId: plan.chat[0]?.id ?? "", index: 9 }),
    ).toBe(plan);
  });

  it("caps chat history so the stored plan stays bounded", () => {
    let plan = makePlan();
    for (let i = 0; i < 205; i += 1) {
      plan = apply(plan, { type: "appendChat", message: { role: "user", text: `m${i}` } });
    }
    expect(plan.chat).toHaveLength(200);
    expect(plan.chat.at(-1)?.text).toBe("m204");
    expect(planSchema.safeParse(plan).success).toBe(true);
  });
});

describe("applyPersonalization", () => {
  it("layers AI tasks and vendors over the skeleton with their reasons", () => {
    const base = makePlan();
    const plan = apply(base, {
      type: "applyPersonalization",
      payload: {
        summary: "Tailored",
        reasoning: "Because Chennai",
        source: "gemini",
        tasks: [{ title: "Book nadaswaram players", due: "2027-05-01", why: "Tamil tradition" }],
        vendors: [{ label: "Priest", category: null, why: "Ceremony", bookBy: "2027-06-01" }],
      },
    });
    expect(plan.tasks).toHaveLength(base.tasks.length + 1);
    expect(plan.tasks.at(-1)).toMatchObject({ source: "ai", why: "Tamil tradition" });
    expect(plan.vendors.at(-1)).toMatchObject({
      label: "Priest",
      source: "ai",
      bookBy: "2027-06-01",
    });
    expect(plan.personalization).toEqual({
      summary: "Tailored",
      reasoning: "Because Chennai",
      source: "gemini",
    });
    expect(planSchema.safeParse(plan).success).toBe(true);
  });
});

describe("briefSchema", () => {
  it("applies defaults for optional fields", () => {
    expect(makeBrief({ city: undefined as unknown as string }).city).toBe("");
  });
});

describe("vendor checklists", () => {
  it("gives every vendor shared steps plus ones specific to its kind", () => {
    const plan = makePlan();
    const caterer = plan.vendors.find((vendor) => vendor.category === "catering");
    const labels = caterer?.checks.map((check) => check.label) ?? [];
    expect(labels).toContain("Sign the contract and read the cancellation terms");
    expect(labels).toContain("Hold a tasting");
    expect(new Set(caterer?.checks.map((check) => check.id)).size).toBe(labels.length);
  });

  it("gives a vendor added by hand the shared steps", () => {
    const plan = apply(makePlan(), { type: "addVendor", label: "Mehendi artist" });
    expect(plan.vendors.at(-1)?.checks.length).toBeGreaterThanOrEqual(6);
  });

  it("toggles one item on one vendor only", () => {
    const plan = makePlan();
    const vendorId = plan.vendors[0]?.id ?? "";
    const checkId = plan.vendors[0]?.checks[0]?.id ?? "";
    const next = apply(plan, { type: "toggleVendorCheck", vendorId, checkId });
    expect(next.vendors[0]?.checks[0]?.done).toBe(true);
    expect(next.vendors[0]?.checks[1]?.done).toBe(false);
    expect(next.vendors[1]?.checks[0]?.done).toBe(false);
    expect(
      apply(next, { type: "toggleVendorCheck", vendorId, checkId }).vendors[0]?.checks[0]?.done,
    ).toBe(false);
  });

  it("stays within the schema for every event type", () => {
    for (const eventType of EVENT_TYPES) {
      expect(planSchema.safeParse(makePlan({ eventType, priorities: [] })).success).toBe(true);
    }
  });
});
