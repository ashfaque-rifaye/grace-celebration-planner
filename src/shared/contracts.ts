/**
 * The typed contract between the browser and the AI endpoint.
 *
 * Input and output schemas for every AI feature live here and are shared by both
 * sides: the server validates requests and model output against them, and the
 * client validates responses, so the wire format has one definition.
 */
import { z } from "zod";
import {
  aiSourceSchema,
  briefSchema,
  budgetMoveSchema,
  BUDGET_CATEGORIES,
  chatMessageSchema,
  CURRENCIES,
  EVENT_TYPES,
  isoDateSchema,
  LANGUAGES,
  planProposalSchema,
  runSheetItemSchema,
  VENDOR_STATUSES,
  vendorBriefSchema,
} from "./schemas";

export const MAX_BRIEF_TEXT = 1000;
export const MAX_CHAT_TEXT = 500;
export const MAX_CHAT_HISTORY = 8;

/**
 * The only view of a plan the model ever sees. Deliberately excludes vendor
 * contact details and notes, which stay in the browser (data minimisation).
 */
export const planContextSchema = z.object({
  today: isoDateSchema,
  daysToGo: z.number().int(),
  title: z.string().max(80),
  eventType: z.enum(EVENT_TYPES),
  date: isoDateSchema,
  guests: z.number().int().min(1),
  city: z.string().max(80),
  vibe: z.string().max(200),
  notes: z.string().max(600),
  currency: z.enum(CURRENCIES),
  language: z.enum(LANGUAGES),
  budgetTotal: z.number().positive(),
  budgetLines: z
    .array(
      z.object({
        id: z.string().max(40),
        label: z.string().max(60),
        allocated: z.number().min(0),
        committed: z.number().min(0),
      }),
    )
    .max(40),
  openTasks: z.array(z.object({ title: z.string().max(160), due: isoDateSchema })).max(15),
  overdueTasks: z.number().int().min(0),
  vendors: z
    .array(
      z.object({
        label: z.string().max(80),
        status: z.enum(VENDOR_STATUSES),
        bookBy: isoDateSchema,
      }),
    )
    .max(30),
  risks: z.array(z.string().max(200)).max(8),
});
export type PlanContext = z.infer<typeof planContextSchema>;

/** Fields the model is allowed to pre-fill from a free-text description. */
const briefDraftSchema = z.object({
  title: z.string().max(80).optional(),
  eventType: z.enum(EVENT_TYPES).optional(),
  date: isoDateSchema.optional(),
  guests: z.number().int().min(1).max(100_000).optional(),
  budget: z.number().positive().max(1_000_000_000_000).optional(),
  currency: z.enum(CURRENCIES).optional(),
  city: z.string().max(80).optional(),
  vibe: z.string().max(200).optional(),
  notes: z.string().max(600).optional(),
  priorities: z.array(z.enum(BUDGET_CATEGORIES)).max(3).optional(),
});
export type BriefDraft = z.infer<typeof briefDraftSchema>;

export const aiContracts = {
  brief: {
    input: z.object({ text: z.string().trim().min(3).max(MAX_BRIEF_TEXT) }),
    output: z.object({
      brief: briefDraftSchema,
      assumptions: z.array(z.string().max(200)).max(5),
      questions: z.array(z.string().max(200)).max(3),
      reasoning: z.string().min(1).max(400),
    }),
  },
  personalize: {
    input: z.object({ brief: briefSchema }),
    output: z.object({
      summary: z.string().min(1).max(600),
      tasks: z
        .array(
          z.object({
            title: z.string().min(1).max(160),
            daysBefore: z.number().int().min(0).max(1000),
            why: z.string().min(1).max(300),
          }),
        )
        .max(6),
      vendors: z
        .array(
          z.object({
            label: z.string().min(1).max(80),
            category: z.enum(BUDGET_CATEGORIES).nullable(),
            daysBefore: z.number().int().min(0).max(1000),
            why: z.string().min(1).max(300),
          }),
        )
        .max(3),
      reasoning: z.string().min(1).max(400),
    }),
  },
  ideas: {
    input: z.object({
      brief: briefSchema,
      steer: z.string().trim().max(200).default(""),
      exclude: z.array(z.string().max(120)).max(30).default([]),
    }),
    output: z.object({
      ideas: z
        .array(
          z.object({
            title: z.string().min(1).max(120),
            description: z.string().min(1).max(500),
            category: z.string().min(1).max(40),
            estimatedCost: z.number().min(0),
            why: z.string().min(1).max(300),
          }),
        )
        .min(1)
        .max(6),
      reasoning: z.string().min(1).max(400),
    }),
  },
  budget: {
    input: z.object({ context: planContextSchema }),
    output: z.object({
      advice: z
        .array(z.object({ title: z.string().min(1).max(120), detail: z.string().min(1).max(400) }))
        .min(1)
        .max(5),
      moves: z.array(budgetMoveSchema).max(4),
      reasoning: z.string().min(1).max(400),
    }),
  },
  vendor: {
    input: z.object({
      brief: briefSchema,
      vendorLabel: z.string().trim().min(1).max(80),
      allocated: z.number().min(0).nullable(),
    }),
    output: vendorBriefSchema.extend({
      questions: z.array(z.string().min(1).max(300)).min(1).max(10),
      reasoning: z.string().min(1).max(400),
    }),
  },
  runsheet: {
    input: z.object({
      brief: briefSchema,
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    output: z.object({
      items: z.array(runSheetItemSchema).min(1).max(20),
      reasoning: z.string().min(1).max(400),
    }),
  },
  chat: {
    input: z.object({
      context: planContextSchema,
      history: z
        .array(chatMessageSchema.pick({ role: true, text: true }))
        .max(MAX_CHAT_HISTORY)
        .default([]),
      message: z.string().trim().min(1).max(MAX_CHAT_TEXT),
    }),
    output: z.object({
      reply: z.string().min(1).max(1500),
      reasoning: z.string().min(1).max(400),
      proposals: z.array(planProposalSchema).max(3).default([]),
    }),
  },
} as const;

export type AiFeatureName = keyof typeof aiContracts;
export const AI_FEATURE_NAMES = Object.keys(aiContracts) as AiFeatureName[];

export type AiInput<F extends AiFeatureName> = z.input<(typeof aiContracts)[F]["input"]>;
export type AiParsedInput<F extends AiFeatureName> = z.output<(typeof aiContracts)[F]["input"]>;
export type AiOutput<F extends AiFeatureName> = z.output<(typeof aiContracts)[F]["output"]>;

/** Why the deterministic planner answered instead of the model. */
export const fallbackReasonSchema = z.enum(["not-configured", "rate-limited", "provider-error"]);
export type FallbackReason = z.infer<typeof fallbackReasonSchema>;

export const aiEnvelopeMeta = z.object({
  /** The provider that actually answered, which drives the honest UI badge. */
  source: aiSourceSchema,
  /** True when a prompt-injection attempt in the input was neutralised. */
  sanitized: z.boolean(),
  cached: z.boolean(),
  fallbackReason: fallbackReasonSchema.optional(),
});
export type AiEnvelopeMeta = z.infer<typeof aiEnvelopeMeta>;

export interface AiEnvelope<F extends AiFeatureName> extends AiEnvelopeMeta {
  data: AiOutput<F>;
}
