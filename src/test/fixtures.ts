import { createPlan } from "../shared/plan";
import { briefSchema, type Brief, type Plan } from "../shared/schemas";

export const TODAY = "2026-11-01";

export function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return briefSchema.parse({
    title: "Asha & Ravi's Wedding",
    eventType: "wedding",
    date: "2027-08-15",
    guests: 200,
    budget: 1_500_000,
    currency: "INR",
    city: "Chennai",
    vibe: "traditional, garden",
    notes: "Vegetarian menu; grandmother uses a wheelchair",
    priorities: ["catering"],
    language: "en",
    ...overrides,
  });
}

export function makePlan(overrides: Partial<Brief> = {}, today = TODAY): Plan {
  return createPlan(makeBrief(overrides), {
    id: "plan-1",
    today,
    now: "2026-11-01T10:00:00.000Z",
  });
}
