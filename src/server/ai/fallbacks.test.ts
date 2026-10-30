import { describe, expect, it } from "vitest";
import { makeBrief, makePlan, TODAY } from "../../test/fixtures";
import { aiContracts } from "../../shared/contracts";
import { buildPlanContext } from "../../shared/plan-context";
import { EVENT_TYPES } from "../../shared/schemas";
import {
  briefFallback,
  budgetFallback,
  chatFallback,
  ideasFallback,
  personalizeFallback,
  runsheetFallback,
  vendorFallback,
} from "./fallbacks";

const parseBrief = (text: string) => briefFallback({ text }, TODAY).brief;

describe("briefFallback", () => {
  it("reads a full description", () => {
    const brief = parseBrief(
      "A wedding in Chennai on 14 February 2027 for 300 guests, budget ₹18 lakh, garden style",
    );
    expect(brief).toMatchObject({
      eventType: "wedding",
      date: "2027-02-14",
      guests: 300,
      budget: 1_800_000,
      currency: "INR",
      city: "Chennai",
      vibe: "garden",
    });
  });

  it.each([
    ["a birthday party", "birthday"],
    ["she is turning 40", "birthday"],
    ["our street party", "community"],
    ["charity fundraiser", "community"],
    ["their sangeet night", "wedding"],
  ])("detects the type from %j", (text, eventType) => {
    expect(parseBrief(text).eventType).toBe(eventType);
  });

  it.each([
    ["₹80,000", 80_000, "INR"],
    ["Rs. 2 lakh", 200_000, "INR"],
    ["1.5 crore rupees", 15_000_000, "INR"],
    ["$5000", 5000, "USD"],
    ["€2k", 2000, "EUR"],
    ["£1.5 million", 1_500_000, "GBP"],
    ["AED 9000", 9000, "AED"],
    ["300 dollars", 300, "USD"],
  ])("reads the amount %s", (text, budget, currency) => {
    expect(parseBrief(`party, cost ${text}`)).toMatchObject({ budget, currency });
  });

  it("reads a budget with no currency", () => {
    const brief = parseBrief("budget of 80k");
    expect(brief.budget).toBe(80_000);
    expect(brief.currency).toBeUndefined();
  });

  it("resolves a date with no year to the next occurrence", () => {
    expect(parseBrief("on March 3rd").date).toBe("2027-03-03");
    expect(parseBrief("on 25 December").date).toBe("2026-12-25");
  });

  it("accepts an ISO date and rejects past or impossible ones", () => {
    expect(parseBrief("on 2027-05-01").date).toBe("2027-05-01");
    expect(parseBrief("on 2020-05-01").date).toBeUndefined();
    expect(parseBrief("on 3 March 2020").date).toBeUndefined();
    expect(parseBrief("on 31 February 2027").date).toBeUndefined();
  });

  it("asks for what it could not find", () => {
    const result = briefFallback({ text: "a lovely party" }, TODAY);
    expect(result.questions).toEqual([
      "What date is the event?",
      "Roughly how many guests are you expecting?",
      "What is your total budget?",
    ]);
  });

  it("does not invent a title when the type is unknown", () => {
    expect(parseBrief("something nice").title).toBeUndefined();
  });

  it("drops a guest count outside the valid range", () => {
    expect(parseBrief("9999999 guests").guests).toBeUndefined();
  });
});

describe("personalizeFallback", () => {
  it("picks up access, dietary and outdoor needs from the notes", () => {
    const { tasks } = personalizeFallback({ brief: makeBrief() });
    const titles = tasks.map((task) => task.title).join(" | ");
    expect(titles).toContain("wet-weather");
    expect(titles).toContain("dietary");
    expect(titles).toContain("step-free");
    expect(tasks.every((task) => task.why.length > 0)).toBe(true);
  });

  it("suggests a coordinator only for large events", () => {
    const big = personalizeFallback({ brief: makeBrief({ guests: 400, notes: "", vibe: "" }) });
    const small = personalizeFallback({ brief: makeBrief({ guests: 20, notes: "", vibe: "" }) });
    expect(big.tasks.some((task) => task.title.includes("coordinator"))).toBe(true);
    expect(small.tasks).toEqual([]);
  });
});

describe("ideasFallback", () => {
  it.each(EVENT_TYPES)("offers costed ideas within budget for a %s", (eventType) => {
    const { ideas } = ideasFallback({
      brief: makeBrief({ eventType, priorities: [] }),
      steer: "",
      exclude: [],
    });
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.every((idea) => idea.estimatedCost <= 1_500_000)).toBe(true);
  });

  it("does not repeat excluded ideas, until the bank runs out", () => {
    const brief = makeBrief();
    const first = ideasFallback({ brief, steer: "", exclude: [] }).ideas.map((i) => i.title);
    const second = ideasFallback({ brief, steer: "", exclude: first }).ideas.map((i) => i.title);
    expect(second.some((title) => first.includes(title))).toBe(false);
    const allTitles = [...first, ...second];
    expect(ideasFallback({ brief, steer: "", exclude: allTitles }).ideas.length).toBeGreaterThan(0);
  });
});

describe("budgetFallback", () => {
  const context = () => buildPlanContext(makePlan(), TODAY);

  it("names the biggest line and the per-guest cost", () => {
    const { advice, moves } = budgetFallback({ context: context() });
    expect(advice[0]?.title).toContain("biggest line");
    expect(advice[1]?.title).toContain("per guest");
    expect(moves).toEqual([]);
  });

  it("proposes an exact move that covers an overspent line", () => {
    const base = context();
    const lines = base.budgetLines.map((line) =>
      line.id === "decor" ? { ...line, committed: line.allocated + 1000 } : line,
    );
    const { moves, advice } = budgetFallback({ context: { ...base, budgetLines: lines } });
    expect(moves[0]).toMatchObject({ to: "decor", amount: 1000 });
    expect(moves[0]?.from).not.toBe("contingency");
    expect(advice.some((item) => item.title.includes("is over"))).toBe(true);
  });

  it("proposes no move when no line can cover the gap", () => {
    const base = context();
    const lines = base.budgetLines.map((line) => ({ ...line, committed: line.allocated + 10 }));
    expect(budgetFallback({ context: { ...base, budgetLines: lines } }).moves).toEqual([]);
  });

  it("copes with an empty budget", () => {
    const result = budgetFallback({ context: { ...context(), budgetLines: [] } });
    expect(result.advice.length).toBeGreaterThan(0);
  });
});

describe("vendorFallback", () => {
  it("refers to the event's date and guests", () => {
    const { questions, negotiationTip } = vendorFallback({
      brief: makeBrief(),
      vendorLabel: "Caterer",
      allocated: 5000,
    });
    expect(questions.join(" ")).toContain("2027-08-15");
    expect(questions.join(" ")).toContain("200 guests");
    expect(negotiationTip).toContain("Caterer");
  });
});

describe("runsheetFallback", () => {
  it.each(EVENT_TYPES)("places a %s around the start time", (eventType) => {
    const { items } = runsheetFallback({
      brief: makeBrief({ eventType, priorities: [] }),
      startTime: "12:00",
    });
    expect(items.length).toBeGreaterThan(5);
    expect(items.every((item) => /^\d{2}:\d{2}$/.test(item.time))).toBe(true);
    expect(items.some((item) => item.time === "12:00")).toBe(true);
  });

  it("wraps around midnight", () => {
    const { items } = runsheetFallback({ brief: makeBrief(), startTime: "01:00" });
    expect(items[0]?.time).toBe("22:00");
  });
});

describe("chatFallback", () => {
  const ask = (message: string) =>
    chatFallback({ context: buildPlanContext(makePlan(), TODAY), history: [], message });

  it("answers budget questions from the plan's real numbers", () => {
    const { reply } = ask("How much money have I spent?");
    expect(reply).toContain("₹15,00,000");
    expect(reply).toContain("largest line");
  });

  it("handles a budget question with no lines", () => {
    const context = { ...buildPlanContext(makePlan(), TODAY), budgetLines: [] };
    const { reply } = chatFallback({ context, history: [], message: "budget?" });
    expect(reply).not.toContain("largest line");
  });

  it("lists vendors still to book", () => {
    expect(ask("which vendors are left?").reply).toContain("still unbooked");
  });

  it("says when all vendors are booked", () => {
    const context = {
      ...buildPlanContext(makePlan(), TODAY),
      vendors: [{ label: "Venue", status: "paid" as const, bookBy: TODAY }],
    };
    const { reply } = chatFallback({ context, history: [], message: "vendors?" });
    expect(reply).toBe("All of your vendors are booked.");
  });

  it("proposes, rather than makes, a change for a rain question", () => {
    const { proposals } = ask("what if it rains?");
    expect(proposals[0]).toMatchObject({ type: "addTask" });
  });

  it("gives a useful default, with or without open tasks", () => {
    expect(ask("hello there").reply).toContain("days to go");
    const context = { ...buildPlanContext(makePlan(), TODAY), openTasks: [] };
    const { reply } = chatFallback({ context, history: [], message: "hello there" });
    expect(reply).not.toContain("Next up");
  });
});

describe("fallbacks satisfy the same contract as the model", () => {
  const brief = makeBrief();
  const context = buildPlanContext(makePlan(), TODAY);

  it("for every feature", () => {
    expect(() => {
      aiContracts.brief.output.parse(briefFallback({ text: "a wedding" }, TODAY));
      aiContracts.personalize.output.parse(personalizeFallback({ brief }));
      aiContracts.ideas.output.parse(ideasFallback({ brief, steer: "", exclude: [] }));
      aiContracts.budget.output.parse(budgetFallback({ context }));
      aiContracts.vendor.output.parse(
        vendorFallback({ brief, vendorLabel: "DJ", allocated: null }),
      );
      aiContracts.runsheet.output.parse(runsheetFallback({ brief, startTime: "10:00" }));
      aiContracts.chat.output.parse(chatFallback({ context, history: [], message: "rain?" }));
    }).not.toThrow();
  });
});
