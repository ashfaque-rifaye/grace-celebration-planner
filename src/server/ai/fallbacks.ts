/**
 * The deterministic planner: what answers when no model can.
 *
 * Every AI feature has a fallback here, so a missing key, an exhausted free tier
 * or a provider outage degrades the app instead of breaking it. The UI badge says
 * plainly when this is what answered. These are honest rules and curated content,
 * and they do not pretend to be as adaptive as the model.
 */
import { addDays, daysBetween, isIsoDate } from "../../shared/dates";
import { formatMoney } from "../../shared/budget";
import { EVENT_TEMPLATES } from "../../shared/templates";
import type { AiOutput, AiParsedInput } from "../../shared/contracts";
import type { Currency, EventType, PlanProposal } from "../../shared/schemas";

// --- Free-text brief -------------------------------------------------------

const TYPE_KEYWORDS: readonly [EventType, RegExp][] = [
  ["wedding", /\b(wedding|marriage|reception|shaadi|sangeet|engagement|nikah)\b/i],
  ["birthday", /\b(birthday|bday|b-day|turning\s+\d+|\d+(?:st|nd|rd|th)\s+party)\b/i],
  [
    "community",
    /\b(community|festival|fair|fundraiser|neighbou?rhood|charity|society|meetup|clean-?up|block party|street party|volunteers?)\b/i,
  ],
];

const CURRENCY_TOKENS: readonly [RegExp, Currency][] = [
  [/^(₹|rs\.?|inr|rupees?)$/i, "INR"],
  [/^(\$|usd|dollars?)$/i, "USD"],
  [/^(€|eur|euros?)$/i, "EUR"],
  [/^(£|gbp|pounds?)$/i, "GBP"],
  [/^(aed|dirhams?)$/i, "AED"],
];

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1_000,
  thousand: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  cr: 10_000_000,
  m: 1_000_000,
  million: 1_000_000,
};

const NUMBER = String.raw`(\d[\d,]{0,15}(?:\.\d{1,2})?)`;
const SCALE = String.raw`(k|thousand|lakhs?|lacs?|crores?|cr|million|m)?`;
const PREFIX_AMOUNT = new RegExp(
  String.raw`(₹|\brs\.?|\binr|\$|\busd|€|\beur|£|\bgbp|\baed)\s*${NUMBER}\s*${SCALE}\b`,
  "i",
);
const SUFFIX_AMOUNT = new RegExp(
  String.raw`${NUMBER}\s*${SCALE}\s*(rupees?|inr|dollars?|usd|euros?|eur|pounds?|gbp|dirhams?|aed)\b`,
  "i",
);
const BUDGET_AMOUNT = new RegExp(
  String.raw`budget\s+(?:of\s+|is\s+|around\s+|about\s+|:\s*)?${NUMBER}\s*${SCALE}\b`,
  "i",
);
const GUESTS =
  /(\d[\d,]{0,6})\s*(?:\+\s*)?(?:guests?|people|persons?|friends|attendees|kids|children|families|pax|neighbou?rs)\b/i;
const CITY = /\b(?:in|at)\s+([A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]{2,})?)/;
const VIBES =
  /\b(rustic|elegant|minimal|boho|garden|beach|rooftop|retro|vintage|traditional|modern|intimate|grand|outdoor|casual|jazz|bollywood|tropical|eco-friendly|sustainable)\b/gi;

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const DAY_MONTH =
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:,?\s+(\d{4}))?/i;
const MONTH_DAY =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i;

function parseAmount(number: string, scale: string | undefined): number {
  const base = Number(number.replace(/,/g, ""));
  return Math.round(base * (scale ? (MULTIPLIERS[scale.toLowerCase()] ?? 1) : 1));
}

function currencyFrom(token: string): Currency | undefined {
  return CURRENCY_TOKENS.find(([pattern]) => pattern.test(token.trim()))?.[1];
}

function parseBudget(text: string): { budget?: number; currency?: Currency } {
  const prefix = PREFIX_AMOUNT.exec(text);
  if (prefix?.[1] && prefix[2]) {
    const currency = currencyFrom(prefix[1]);
    return { budget: parseAmount(prefix[2], prefix[3]), ...(currency ? { currency } : {}) };
  }
  const suffix = SUFFIX_AMOUNT.exec(text);
  if (suffix?.[1] && suffix[3]) {
    const currency = currencyFrom(suffix[3]);
    return { budget: parseAmount(suffix[1], suffix[2]), ...(currency ? { currency } : {}) };
  }
  const bare = BUDGET_AMOUNT.exec(text);
  return bare?.[1] ? { budget: parseAmount(bare[1], bare[2]) } : {};
}

function parseDate(text: string, today: string): string | undefined {
  const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
  if (iso && isIsoDate(iso) && iso >= today) return iso;

  const dayFirst = DAY_MONTH.exec(text);
  const monthFirst = MONTH_DAY.exec(text);
  const [day, month, year] = dayFirst
    ? [dayFirst[1], dayFirst[2], dayFirst[3]]
    : [monthFirst?.[2], monthFirst?.[1], monthFirst?.[3]];
  if (!day || !month) return undefined;

  const monthNumber = MONTHS.indexOf(month.toLowerCase().slice(0, 3)) + 1;
  const build = (y: string | number): string =>
    `${y}-${String(monthNumber).padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (year) {
    const explicit = build(year);
    return isIsoDate(explicit) && explicit >= today ? explicit : undefined;
  }
  // No year given: the next time this date comes around.
  const thisYear = Number(today.slice(0, 4));
  const candidate = build(thisYear);
  const resolved = candidate >= today ? candidate : build(thisYear + 1);
  return isIsoDate(resolved) ? resolved : undefined;
}

export function briefFallback(input: AiParsedInput<"brief">, today: string): AiOutput<"brief"> {
  const { text } = input;
  const eventType = TYPE_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0];
  const guestsMatch = GUESTS.exec(text)?.[1];
  const guests = guestsMatch ? Number(guestsMatch.replace(/,/g, "")) : undefined;
  const { budget, currency } = parseBudget(text);
  const date = parseDate(text, today);
  const city = CITY.exec(text)?.[1];
  const vibes = [...new Set((text.match(VIBES) ?? []).map((v) => v.toLowerCase()))];
  const title = eventType
    ? `${EVENT_TEMPLATES[eventType].label}${city ? ` in ${city}` : ""}`
    : undefined;

  const questions: string[] = [];
  if (!date) questions.push("What date is the event?");
  if (!guests) questions.push("Roughly how many guests are you expecting?");
  if (!budget) questions.push("What is your total budget?");

  return {
    brief: {
      ...(title ? { title } : {}),
      ...(eventType ? { eventType } : {}),
      ...(date ? { date } : {}),
      ...(guests && guests >= 1 && guests <= 100_000 ? { guests } : {}),
      ...(budget && budget > 0 ? { budget } : {}),
      ...(currency ? { currency } : {}),
      ...(city ? { city } : {}),
      ...(vibes.length ? { vibe: vibes.join(", ") } : {}),
      notes: text.slice(0, 600),
    },
    assumptions: [],
    questions: questions.slice(0, 3),
    reasoning: "Read with simple pattern matching because the AI model was unavailable.",
  };
}

// --- Personalised plan -----------------------------------------------------

const PERSONALISATION_RULES: readonly {
  when: RegExp;
  title: string;
  daysBefore: number;
  why: string;
}[] = [
  {
    when: /\b(outdoor|garden|beach|rooftop|lawn|park)\b/i,
    title: "Line up a wet-weather backup for the outdoor space",
    daysBefore: 30,
    why: "You mentioned an outdoor setting, and weather is the risk you cannot book away.",
  },
  {
    when: /\b(vegan|vegetarian|jain|halal|kosher|allerg|gluten|dietary)\b/i,
    title: "Collect dietary needs and brief the caterer",
    daysBefore: 21,
    why: "You mentioned dietary needs, which must reach the caterer before the menu is locked.",
  },
  {
    when: /\b(wheelchair|accessib|elderly|grandparents?|step-free|disabled)\b/i,
    title: "Check step-free access, seating and restrooms at the venue",
    daysBefore: 45,
    why: "You mentioned access needs, and these are far easier to solve before the venue is final.",
  },
  {
    when: /\b(kids?|children|toddlers?)\b/i,
    title: "Plan a supervised kids' corner",
    daysBefore: 14,
    why: "Children are attending, and a dedicated space keeps them happy and parents relaxed.",
  },
  {
    when: /\bsurprise\b/i,
    title: "Agree the surprise plan and a cover story with one trusted helper",
    daysBefore: 14,
    why: "A surprise needs one person coordinating arrival times and keeping the secret.",
  },
];

export function personalizeFallback(input: AiParsedInput<"personalize">): AiOutput<"personalize"> {
  const { brief } = input;
  const haystack = `${brief.vibe} ${brief.notes} ${brief.title}`;
  const tasks = PERSONALISATION_RULES.filter((rule) => rule.when.test(haystack)).map(
    ({ title, daysBefore, why }) => ({ title, daysBefore, why }),
  );
  if (brief.guests >= 150) {
    tasks.push({
      title: "Appoint a day-of coordinator for guest flow",
      daysBefore: 30,
      why: `With ${brief.guests} guests, someone has to own arrivals and queues on the day.`,
    });
  }
  return {
    summary: `A ${EVENT_TEMPLATES[brief.eventType].label.toLowerCase()} plan for ${brief.guests} guests, built from Grace's standard playbook.`,
    tasks: tasks.slice(0, 6),
    vendors: [],
    reasoning: "Matched your notes against planning rules because the AI model was unavailable.",
  };
}

// --- Ideas -----------------------------------------------------------------

const IDEA_BANK: Readonly<
  Record<
    EventType,
    readonly { title: string; description: string; category: string; share: number; why: string }[]
  >
> = {
  wedding: [
    {
      title: "Family recipe dessert table",
      description:
        "Ask each side of the family for one recipe and label every dish with its story.",
      category: "Food",
      share: 0.02,
      why: "Personal and memorable, and it brings both families into the celebration.",
    },
    {
      title: "Audio guest book",
      description: "A vintage phone that records voice messages from guests through the evening.",
      category: "Keepsake",
      share: 0.01,
      why: "You keep the voices of the day for far less than a second photographer.",
    },
    {
      title: "Blooms that travel",
      description: "Reuse ceremony florals at the reception, then send them home with guests.",
      category: "Decor",
      share: 0.02,
      why: "Reusing flowers stretches the decor budget and reduces waste.",
    },
    {
      title: "Couple's first-dance surprise",
      description: "Start with a slow song, then switch to a choreographed family dance.",
      category: "Entertainment",
      share: 0.005,
      why: "A planned moment gives your photographer a highlight at almost no cost.",
    },
    {
      title: "Sparkler or lantern send-off",
      description: "End the night with guests lining the exit holding low-smoke lights.",
      category: "Moment",
      share: 0.01,
      why: "It creates a closing photo and a clear end to the evening.",
    },
  ],
  birthday: [
    {
      title: "Decade time-capsule wall",
      description: "Guests pin up photos and notes from each era of the guest of honour's life.",
      category: "Activity",
      share: 0.02,
      why: "It costs little and gets people talking to those they have not met.",
    },
    {
      title: "Build-your-own dessert bar",
      description: "Replace a single large cake with a small cake and a toppings station.",
      category: "Food",
      share: 0.05,
      why: "Everyone customises their own, and the station doubles as an activity.",
    },
    {
      title: "Crowd-sourced playlist",
      description: "Each guest adds one song to a shared playlist when they RSVP.",
      category: "Music",
      share: 0,
      why: "It is free, and it means everyone hears their song at some point.",
    },
    {
      title: "Memory-jar toast",
      description: "Guests drop in a favourite memory, and a few are read out before the cake.",
      category: "Moment",
      share: 0.005,
      why: "It gives the party an emotional high point without needing speeches.",
    },
    {
      title: "Themed photo corner",
      description: "A simple backdrop and props matched to your theme, with a shared album.",
      category: "Decor",
      share: 0.03,
      why: "It doubles as decor and gives guests something to do while they arrive.",
    },
  ],
  community: [
    {
      title: "Local talent open stage",
      description: "Give ten-minute slots to neighbourhood performers, schools and clubs.",
      category: "Entertainment",
      share: 0.03,
      why: "Performers bring their own families, which grows attendance at no extra cost.",
    },
    {
      title: "Stall passport",
      description: "Attendees collect a stamp from each stall to earn a small prize.",
      category: "Engagement",
      share: 0.02,
      why: "It moves people around the whole site and gives every stall visitors.",
    },
    {
      title: "Sponsor a street",
      description: "Invite local shops to sponsor one street or stall in return for signage.",
      category: "Funding",
      share: 0,
      why: "It offsets your costs and gives local businesses a real stake in the day.",
    },
    {
      title: "Volunteer thank-you hour",
      description: "Close the event with food and recognition for the volunteers.",
      category: "Community",
      share: 0.02,
      why: "It is the cheapest way to make sure volunteers come back next year.",
    },
    {
      title: "Zero-waste pledge station",
      description: "Clearly signed sorting bins, with a team of young volunteers to guide people.",
      category: "Sustainability",
      share: 0.01,
      why: "It keeps the site clean and makes the permit conversation easier.",
    },
  ],
};

export function ideasFallback(input: AiParsedInput<"ideas">): AiOutput<"ideas"> {
  const { brief, exclude } = input;
  const excluded = new Set(exclude.map((title) => title.toLowerCase()));
  const bank = IDEA_BANK[brief.eventType];
  const fresh = bank.filter((idea) => !excluded.has(idea.title.toLowerCase()));
  const ideas = (fresh.length > 0 ? fresh : bank).slice(0, 4).map((idea) => ({
    title: idea.title,
    description: idea.description,
    category: idea.category,
    estimatedCost: Math.round(brief.budget * idea.share),
    why: idea.why,
  }));
  return {
    ideas,
    reasoning: "Curated ideas for this event type, because the AI model was unavailable.",
  };
}

// --- Budget review ---------------------------------------------------------

export function budgetFallback(input: AiParsedInput<"budget">): AiOutput<"budget"> {
  const { context } = input;
  const money = (amount: number) => formatMoney(amount, context.currency);
  const lines = [...context.budgetLines];
  const over = lines.filter((line) => line.committed > line.allocated);
  const slack = lines
    .filter((line) => line.id !== "contingency" && line.committed < line.allocated)
    .sort((a, b) => b.allocated - b.committed - (a.allocated - a.committed));
  const largest = [...lines].sort((a, b) => b.allocated - a.allocated)[0];

  const advice: AiOutput<"budget">["advice"] = [];
  if (largest) {
    advice.push({
      title: `${largest.label} is your biggest line`,
      detail: `${money(largest.allocated)} of ${money(context.budgetTotal)}. Negotiating here moves the total more than any other line.`,
    });
  }
  advice.push({
    title: `About ${money(Math.round(context.budgetTotal / context.guests))} per guest`,
    detail: `Each extra guest raises food and seating costs, so trimming the list is usually the strongest lever you have.`,
  });
  for (const line of over.slice(0, 2)) {
    advice.push({
      title: `${line.label} is over`,
      detail: `Committed ${money(line.committed)} against ${money(line.allocated)}.`,
    });
  }

  const moves: AiOutput<"budget">["moves"] = [];
  for (const line of over.slice(0, 2)) {
    const donor = slack[0];
    const needed = line.committed - line.allocated;
    if (donor && donor.allocated - donor.committed >= needed) {
      moves.push({
        from: donor.id,
        to: line.id,
        amount: needed,
        why: `${donor.label} has the most room, and this covers ${line.label} exactly.`,
      });
    }
  }
  return {
    advice: advice.slice(0, 5),
    moves,
    reasoning: "Calculated from your budget lines, because the AI model was unavailable.",
  };
}

// --- Vendor questions ------------------------------------------------------

export function vendorFallback(input: AiParsedInput<"vendor">): AiOutput<"vendor"> {
  const { vendorLabel, brief } = input;
  return {
    questions: [
      `Are you available on ${brief.date}, and can you hold that date while we decide?`,
      `What exactly is included for ${brief.guests} guests, and what costs extra?`,
      "What deposit do you need, when is the balance due, and what is your cancellation policy?",
      "Who will be there on the day, and what happens if they are unwell?",
      "Can we see recent work or speak to someone you served at a similar event?",
    ],
    redFlags: [
      "Will not put the price and inclusions in writing",
      "Asks for full payment well before the event",
    ],
    negotiationTip: `Ask ${vendorLabel} what they could remove to reach your budget, rather than asking for a discount on the same scope.`,
    reasoning: "A standard vetting checklist, because the AI model was unavailable.",
  };
}

// --- Run sheet -------------------------------------------------------------

const RUN_SHEETS: Readonly<Record<EventType, readonly [number, string, string][]>> = {
  wedding: [
    [-180, "Vendors arrive and set up", "Coordinator"],
    [-60, "Final walk-through and photos", "Coordinator"],
    [-15, "Guests seated", "Ushers"],
    [0, "Ceremony begins", "Officiant"],
    [60, "Family photographs and refreshments", "Photographer"],
    [120, "Reception opens and meal served", "Caterer"],
    [210, "Speeches and cake", "Host"],
    [240, "Dancing", "DJ or band"],
    [360, "Send-off and pack-down", "Coordinator"],
  ],
  birthday: [
    [-120, "Set up decorations and music", "Host"],
    [-20, "Food set out and final check", "Host"],
    [0, "Guests arrive", "Host"],
    [45, "Activity or games", "Entertainer"],
    [90, "Food served", "Host"],
    [135, "Cake and toast", "Host"],
    [180, "Music and free time", "Host"],
    [240, "Wind down and favours", "Host"],
  ],
  community: [
    [-180, "Suppliers arrive and stage set up", "Site lead"],
    [-60, "Volunteer briefing", "Volunteer lead"],
    [-15, "Safety and first-aid check", "Safety lead"],
    [0, "Gates open", "Volunteer lead"],
    [30, "Welcome announcement", "Host"],
    [60, "Main programme begins", "Stage manager"],
    [180, "Prize draw and thank-yous", "Host"],
    [240, "Gates close", "Volunteer lead"],
    [270, "Clean-up and site handback", "Site lead"],
  ],
};

function shiftTime(start: string, minutes: number): string {
  const [hours = 0, mins = 0] = start.split(":").map(Number);
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function runsheetFallback(input: AiParsedInput<"runsheet">): AiOutput<"runsheet"> {
  return {
    items: RUN_SHEETS[input.brief.eventType].map(([offset, title, owner]) => ({
      time: shiftTime(input.startTime, offset),
      title,
      owner,
    })),
    reasoning:
      "A standard running order for this event type, because the AI model was unavailable.",
  };
}

// --- Assistant -------------------------------------------------------------

export function chatFallback(input: AiParsedInput<"chat">): AiOutput<"chat"> {
  const { context, message } = input;
  const money = (amount: number) => formatMoney(amount, context.currency);
  const text = message.toLowerCase();
  const reasoning = "Answered from your plan data, because the AI model was unavailable.";

  if (/budget|money|cost|spend|afford|cheap|save/.test(text)) {
    const committed = context.budgetLines.reduce((acc, line) => acc + line.committed, 0);
    const largest = [...context.budgetLines].sort((a, b) => b.allocated - a.allocated)[0];
    return {
      reply: `You have committed ${money(committed)} of ${money(context.budgetTotal)}.${largest ? ` ${largest.label} is your largest line at ${money(largest.allocated)}, so that is the best place to look for savings.` : ""}`,
      reasoning,
      proposals: [],
    };
  }
  if (/vendor|book|supplier|caterer|photograph|venue/.test(text)) {
    const open = context.vendors.filter((v) => v.status === "to-contact" || v.status === "quoted");
    return {
      reply: open.length
        ? `${open.length} vendors are still unbooked. Next up: ${open
            .sort((a, b) => a.bookBy.localeCompare(b.bookBy))
            .slice(0, 3)
            .map((v) => `${v.label} (by ${v.bookBy})`)
            .join(", ")}.`
        : "All of your vendors are booked.",
      reasoning,
      proposals: [],
    };
  }
  if (/rain|weather|backup|emergency|cancel/.test(text)) {
    const proposal: PlanProposal = {
      type: "addTask",
      title: "Confirm a backup plan with the venue",
      due: addDays(context.today, Math.min(7, Math.max(0, context.daysToGo))),
      why: "A confirmed backup removes the biggest risk you cannot control.",
    };
    return {
      reply:
        "Agree a backup with your venue now, including the deadline for making the call on the day. I can add that as a task.",
      reasoning,
      proposals: [proposal],
    };
  }
  const next = context.openTasks[0];
  const days = daysBetween(context.today, context.date);
  return {
    reply: `${days} days to go, with ${context.openTasks.length} open tasks in view.${next ? ` Next up: "${next.title}", due ${next.due}.` : ""} Ask me about your budget, vendors or backup plans.`,
    reasoning,
    proposals: [],
  };
}
