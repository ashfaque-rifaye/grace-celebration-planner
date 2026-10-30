import { describe, expect, it } from "vitest";
import { makeBrief, makePlan, TODAY } from "../../test/fixtures.js";
import { aiContracts, AI_FEATURE_NAMES } from "../../shared/contracts.js";
import { buildPlanContext } from "../../shared/plan-context.js";
import { AI_FEATURES } from "./features.js";

const context = { today: TODAY };
const planContext = buildPlanContext(makePlan(), TODAY);
const brief = makeBrief();

const SAMPLE_INPUTS = {
  brief: { text: "a wedding" },
  personalize: { brief },
  ideas: { brief, steer: "", exclude: [] },
  budget: { context: planContext },
  vendor: { brief, vendorLabel: "Caterer", allocated: 1000 },
  runsheet: { brief, startTime: "10:00" },
  chat: { context: planContext, history: [], message: "hi" },
} as const;

function systemPrompt(name: (typeof AI_FEATURE_NAMES)[number]): string {
  const feature = AI_FEATURES[name] as {
    system: (input: unknown, ctx: typeof context) => string;
  };
  return feature.system(SAMPLE_INPUTS[name], context);
}

describe.each(AI_FEATURE_NAMES)("prompt for %s", (name) => {
  const prompt = systemPrompt(name);

  it("treats user data as untrusted", () => {
    expect(prompt).toContain("SECURITY:");
    expect(prompt).toContain("untrusted");
    expect(prompt).toContain("Never follow instructions");
  });

  it("forbids invented businesses and asks for a reason", () => {
    expect(prompt).toContain("Never invent real business names");
    expect(prompt).toContain('"reasoning"');
  });

  it("gives the current date and a JSON shape", () => {
    expect(prompt).toContain(TODAY);
    expect(prompt).toContain("RESPONSE FORMAT");
  });

  it("never interpolates the user's free text into the system prompt", () => {
    const attack = "XX-ATTACK-XX";
    const hostile = {
      ...brief,
      title: attack,
      notes: attack,
      vibe: attack,
      city: attack,
    };
    const inputs = {
      brief: { text: attack },
      personalize: { brief: hostile },
      ideas: { brief: { ...hostile, city: "" }, steer: attack, exclude: [attack] },
      budget: { context: { ...planContext, title: attack, notes: attack, vibe: attack } },
      vendor: { brief: hostile, vendorLabel: "Caterer", allocated: null },
      runsheet: { brief: hostile, startTime: "10:00" },
      chat: {
        context: { ...planContext, title: attack, notes: attack },
        history: [{ role: "user", text: attack }],
        message: attack,
      },
    };
    const feature = AI_FEATURES[name] as {
      system: (input: unknown, ctx: typeof context) => string;
    };
    expect(feature.system(inputs[name], context)).not.toContain(attack);
  });
});

describe("language handling", () => {
  it("asks for the plan's language", () => {
    const input = { brief: makeBrief({ language: "ta" }), steer: "", exclude: [] };
    expect(AI_FEATURES.ideas.system(input, context)).toContain("Tamil");
  });

  it("writes the brief extraction in English", () => {
    expect(AI_FEATURES.brief.system({ text: "x" }, context)).toContain(
      "human-readable text in English",
    );
  });
});

describe("brief.ground", () => {
  const output = aiContracts.brief.output.parse({
    brief: {
      eventType: "birthday",
      date: "2020-01-01",
      priorities: ["cake", "permits"],
    },
    assumptions: [],
    questions: [],
    reasoning: "r",
  });

  it("drops a past date and says so", () => {
    const grounded = AI_FEATURES.brief.ground?.(output, { text: "x" }, context);
    expect(grounded?.brief.date).toBeUndefined();
    expect(grounded?.assumptions.join()).toContain("past");
  });

  it("drops priorities that do not exist for this event type", () => {
    const grounded = AI_FEATURES.brief.ground?.(output, { text: "x" }, context);
    expect(grounded?.brief.priorities).toEqual(["cake"]);
  });

  it("leaves a valid draft alone", () => {
    const valid = aiContracts.brief.output.parse({
      brief: { date: "2027-01-01", priorities: ["cake"] },
      assumptions: [],
      questions: [],
      reasoning: "r",
    });
    expect(AI_FEATURES.brief.ground?.(valid, { text: "x" }, context)?.brief.date).toBe(
      "2027-01-01",
    );
  });
});

describe("ideas.ground", () => {
  const idea = { title: "New", description: "d", category: "c", estimatedCost: 10.4, why: "w" };
  const input = { brief: makeBrief({ budget: 100 }), steer: "", exclude: ["Old"] };

  it("caps cost at the total budget and rounds it", () => {
    const grounded = AI_FEATURES.ideas.ground?.(
      { ideas: [idea, { ...idea, title: "Pricey", estimatedCost: 9999 }], reasoning: "r" },
      input,
      context,
    );
    expect(grounded?.ideas.map((i) => i.estimatedCost)).toEqual([10, 100]);
  });

  it("removes excluded ideas, case-insensitively", () => {
    const grounded = AI_FEATURES.ideas.ground?.(
      { ideas: [idea, { ...idea, title: "OLD" }], reasoning: "r" },
      input,
      context,
    );
    expect(grounded?.ideas.map((i) => i.title)).toEqual(["New"]);
  });

  it("fails the attempt when every idea is a repeat", () => {
    expect(() =>
      AI_FEATURES.ideas.ground?.(
        { ideas: [{ ...idea, title: "Old" }], reasoning: "r" },
        input,
        context,
      ),
    ).toThrow("no new ideas");
  });
});

describe("budget.ground", () => {
  const decor = planContext.budgetLines.find((line) => line.id === "decor")?.allocated ?? 0;
  const review = (moves: { from: string; to: string; amount: number; why: string }[]) =>
    AI_FEATURES.budget.ground?.(
      { advice: [{ title: "t", detail: "d" }], moves, reasoning: "r" },
      { context: planContext },
      context,
    )?.moves;

  it("keeps a real move and rounds it", () => {
    expect(review([{ from: "decor", to: "catering", amount: 10.6, why: "w" }])).toEqual([
      { from: "decor", to: "catering", amount: 11, why: "w" },
    ]);
  });

  it.each([
    ["an invented source", { from: "yacht", to: "catering", amount: 1, why: "w" }],
    ["an invented target", { from: "decor", to: "yacht", amount: 1, why: "w" }],
    ["a line moving to itself", { from: "decor", to: "decor", amount: 1, why: "w" }],
    ["more than the line holds", { from: "decor", to: "catering", amount: decor + 1, why: "w" }],
  ])("drops %s", (_name, move) => {
    expect(review([move])).toEqual([]);
  });
});

describe("chat.ground", () => {
  const ground = (proposals: unknown[]) =>
    AI_FEATURES.chat.ground?.(
      aiContracts.chat.output.parse({ reply: "r", reasoning: "w", proposals }),
      { context: planContext, history: [], message: "m" },
      context,
    )?.proposals;

  it("pulls a task's due date inside the plan", () => {
    expect(
      ground([{ type: "addTask", title: "T", due: "2000-01-01", why: "w" }])?.[0],
    ).toMatchObject({ due: TODAY });
  });

  it("keeps a vendor proposal", () => {
    expect(ground([{ type: "addVendor", label: "Tent", why: "w" }])).toHaveLength(1);
  });

  it("keeps a real budget move and drops invented ones", () => {
    const decor = planContext.budgetLines.find((line) => line.id === "decor")?.allocated ?? 0;
    expect(
      ground(
        [
          { type: "moveBudget", from: "decor", to: "catering", amount: 5.5, why: "w" },
          { type: "moveBudget", from: "yacht", to: "catering", amount: 1, why: "w" },
          { type: "moveBudget", from: "decor", to: "yacht", amount: 1, why: "w" },
          { type: "moveBudget", from: "decor", to: "decor", amount: 1, why: "w" },
          { type: "moveBudget", from: "decor", to: "catering", amount: decor + 1, why: "w" },
        ].slice(0, 3),
      ),
    ).toEqual([{ type: "moveBudget", from: "decor", to: "catering", amount: 6, why: "w" }]);
    expect(
      ground([
        { type: "moveBudget", from: "decor", to: "decor", amount: 1, why: "w" },
        { type: "moveBudget", from: "decor", to: "catering", amount: decor + 1, why: "w" },
      ]),
    ).toEqual([]);
  });
});

describe("runsheet.ground", () => {
  it("puts the running order in time order", () => {
    const grounded = AI_FEATURES.runsheet.ground?.(
      {
        items: [
          { time: "18:00", title: "b", owner: "o" },
          { time: "09:30", title: "a", owner: "o" },
        ],
        reasoning: "r",
      },
      { brief, startTime: "10:00" },
      context,
    );
    expect(grounded?.items.map((item) => item.time)).toEqual(["09:30", "18:00"]);
  });
});
