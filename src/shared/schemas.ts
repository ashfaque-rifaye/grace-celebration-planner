/**
 * Domain schemas: the single source of truth for what an event plan is.
 *
 * The same schemas validate form input, localStorage reads, imported backups and
 * API payloads, so a plan cannot enter the app through any door without passing
 * the same checks. Every string and array is bounded to cap memory and tokens.
 */
import { z } from "zod";
import { isIsoDate } from "./dates.js";

export const EVENT_TYPES = ["wedding", "birthday", "community"] as const;
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;
export const LANGUAGES = ["en", "hi", "ta", "es", "fr", "ar"] as const;
export const VENDOR_STATUSES = ["to-contact", "quoted", "booked", "paid"] as const;

export const BUDGET_CATEGORIES = [
  "venue",
  "catering",
  "decor",
  "attire",
  "photography",
  "entertainment",
  "stationery",
  "transport",
  "favours",
  "cake",
  "permits",
  "av",
  "marketing",
  "volunteers",
  "safety",
  "contingency",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type Currency = (typeof CURRENCIES)[number];
export type Language = (typeof LANGUAGES)[number];
export type VendorStatus = (typeof VENDOR_STATUSES)[number];
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const MAX_BUDGET = 1_000_000_000_000;
export const MAX_GUESTS = 100_000;
export const MAX_PRIORITIES = 3;

export const isoDateSchema = z.string().refine(isIsoDate, "Enter a valid date");
const moneySchema = z.number().finite().min(0).max(MAX_BUDGET);

export const briefSchema = z.object({
  title: z.string().trim().min(1, "Give your event a name").max(80),
  eventType: z.enum(EVENT_TYPES),
  date: isoDateSchema,
  guests: z
    .number({ error: "Enter the number of guests" })
    .int("Guests must be a whole number")
    .min(1, "Enter at least 1 guest")
    .max(MAX_GUESTS, `Guests cannot exceed ${MAX_GUESTS.toLocaleString("en-US")}`),
  budget: z
    .number({ error: "Enter your total budget" })
    .positive("Budget must be more than zero")
    .max(MAX_BUDGET, "That budget is too large to plan with"),
  currency: z.enum(CURRENCIES),
  city: z.string().trim().max(80).default(""),
  vibe: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(600).default(""),
  priorities: z.array(z.enum(BUDGET_CATEGORIES)).max(MAX_PRIORITIES).default([]),
  language: z.enum(LANGUAGES).default("en"),
});
export type Brief = z.infer<typeof briefSchema>;

export const budgetLineSchema = z.object({
  id: z.string().max(40),
  category: z.enum(BUDGET_CATEGORIES).nullable(),
  label: z.string().max(60),
  allocated: moneySchema,
  /** Spend logged by hand, on top of what booked vendors commit to this line. */
  spent: moneySchema,
});
export type BudgetLine = z.infer<typeof budgetLineSchema>;

export const taskSourceSchema = z.enum(["template", "ai", "you"]);
export type TaskSource = z.infer<typeof taskSourceSchema>;

export const taskSchema = z.object({
  id: z.string().max(40),
  title: z.string().trim().min(1).max(160),
  due: isoDateSchema,
  done: z.boolean(),
  source: taskSourceSchema,
  why: z.string().max(300).optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const vendorBriefSchema = z.object({
  questions: z.array(z.string().max(300)).max(10),
  redFlags: z.array(z.string().max(300)).max(6),
  negotiationTip: z.string().max(400),
  reasoning: z.string().max(400),
});
export type VendorBrief = z.infer<typeof vendorBriefSchema>;

export const vendorSchema = z.object({
  id: z.string().max(40),
  label: z.string().trim().min(1).max(80),
  category: z.enum(BUDGET_CATEGORIES).nullable(),
  status: z.enum(VENDOR_STATUSES),
  bookBy: isoDateSchema,
  quote: moneySchema.nullable(),
  /** Private to this browser: contact details are never sent to the AI. */
  contact: z.string().max(120),
  notes: z.string().max(400),
  source: taskSourceSchema,
  why: z.string().max(300).optional(),
  brief: vendorBriefSchema.optional(),
  checks: z
    .array(z.object({ id: z.string().max(40), label: z.string().max(120), done: z.boolean() }))
    .max(12),
});
export type Vendor = z.infer<typeof vendorSchema>;

export const ideaSchema = z.object({
  id: z.string().max(40),
  title: z.string().max(120),
  description: z.string().max(500),
  category: z.string().max(40),
  estimatedCost: moneySchema,
  why: z.string().max(300),
  saved: z.boolean(),
});
export type Idea = z.infer<typeof ideaSchema>;

export const runSheetItemSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM"),
  title: z.string().max(160),
  owner: z.string().max(60),
});
export type RunSheetItem = z.infer<typeof runSheetItemSchema>;

export const budgetMoveSchema = z.object({
  from: z.string().max(40),
  to: z.string().max(40),
  amount: z.number().positive().max(MAX_BUDGET),
  why: z.string().max(300),
});
export type BudgetMove = z.infer<typeof budgetMoveSchema>;

/**
 * Changes the assistant may *propose*. They are data, applied only after the
 * user approves, and every one passes through the plan reducer's own checks.
 */
export const planProposalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("addTask"),
    title: z.string().trim().min(1).max(160),
    due: isoDateSchema,
    why: z.string().max(300),
  }),
  z.object({
    type: z.literal("addVendor"),
    label: z.string().trim().min(1).max(80),
    why: z.string().max(300),
  }),
  z.object({
    type: z.literal("moveBudget"),
    from: z.string().max(40),
    to: z.string().max(40),
    amount: z.number().positive().max(MAX_BUDGET),
    why: z.string().max(300),
  }),
]);
export type PlanProposal = z.infer<typeof planProposalSchema>;

export const aiSourceSchema = z.enum(["gemini", "fireworks", "fallback"]);
export type AiSource = z.infer<typeof aiSourceSchema>;

export const chatMessageSchema = z.object({
  id: z.string().max(40),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(2000),
  reasoning: z.string().max(400).optional(),
  source: aiSourceSchema.optional(),
  proposals: z.array(planProposalSchema).max(4).optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const personalizationSchema = z.object({
  summary: z.string().max(600),
  reasoning: z.string().max(400),
  source: aiSourceSchema,
});

export const budgetReviewSchema = z.object({
  advice: z.array(z.object({ title: z.string().max(120), detail: z.string().max(400) })).max(5),
  moves: z.array(budgetMoveSchema).max(4),
  reasoning: z.string().max(400),
  source: aiSourceSchema,
});
export type BudgetReview = z.infer<typeof budgetReviewSchema>;

export const PLAN_VERSION = 1;

export const planSchema = z.object({
  version: z.literal(PLAN_VERSION),
  id: z.string().min(1).max(64),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  /** Counter for ids minted by the reducer, which keeps the reducer pure. */
  seq: z.number().int().min(0),
  brief: briefSchema,
  budgetLines: z.array(budgetLineSchema).max(40),
  tasks: z.array(taskSchema).max(300),
  vendors: z.array(vendorSchema).max(60),
  ideas: z.array(ideaSchema).max(60),
  runSheet: z.array(runSheetItemSchema).max(40),
  chat: z.array(chatMessageSchema).max(200),
  personalization: personalizationSchema.nullable(),
  budgetReview: budgetReviewSchema.nullable(),
});
export type Plan = z.infer<typeof planSchema>;
export type Personalization = z.infer<typeof personalizationSchema>;
