/**
 * Plan construction and the reducer behind every change to a plan.
 *
 * All edits, whether typed by the user or proposed by the AI and approved, flow
 * through `planReducer`. It is pure, so the rules that protect a plan (a move
 * must be affordable, a due date must fall before the event) live in one tested
 * place and an AI suggestion gets no special path around them.
 */
import { applyBudgetMove, rebalanceLines, buildBudgetLines } from "./budget.js";
import { EVENT_TEMPLATES, vendorChecklist } from "./templates.js";
import { clampDate, scheduleTasks, vendorBookBy } from "./timeline.js";
import {
  PLAN_VERSION,
  type BudgetCategory,
  type BudgetReview,
  type Brief,
  type ChatMessage,
  type Idea,
  type Personalization,
  type Plan,
  type PlanProposal,
  type RunSheetItem,
  type Vendor,
  type VendorBrief,
} from "./schemas.js";

const MAX_CHAT_MESSAGES = 200;

function checksFor(category: BudgetCategory | null): Vendor["checks"] {
  return vendorChecklist(category).map((label, index) => ({
    id: `check-${index + 1}`,
    label,
    done: false,
  }));
}

export function createPlan(
  brief: Brief,
  options: { id: string; today: string; now: string },
): Plan {
  const template = EVENT_TEMPLATES[brief.eventType];
  const longestLead = Math.max(...template.vendors.map((vendor) => vendor.leadDays));
  return {
    version: PLAN_VERSION,
    id: options.id,
    createdAt: options.now,
    updatedAt: options.now,
    seq: 0,
    brief,
    budgetLines: buildBudgetLines(brief),
    tasks: scheduleTasks(template.tasks, options.today, brief.date),
    vendors: template.vendors.map((vendor, index) => ({
      id: `vendor-${index + 1}`,
      label: vendor.label,
      category: vendor.category,
      status: "to-contact",
      bookBy: vendorBookBy(vendor, longestLead, options.today, brief.date),
      quote: null,
      contact: "",
      notes: "",
      source: "template",
      checks: checksFor(vendor.category),
    })),
    ideas: [],
    runSheet: [],
    chat: [],
    personalization: null,
    budgetReview: null,
  };
}

export interface PersonalizationPayload {
  summary: string;
  reasoning: string;
  source: Personalization["source"];
  tasks: readonly { title: string; due: string; why: string }[];
  vendors: readonly {
    label: string;
    category: BudgetCategory | null;
    why: string;
    bookBy: string;
  }[];
}

export type PlanAction =
  | { type: "toggleTask"; id: string }
  | { type: "addTask"; title: string; due: string; why?: string; source?: "ai" | "you" }
  | { type: "removeTask"; id: string }
  | { type: "setLineAllocated"; id: string; amount: number }
  | { type: "setLineSpent"; id: string; amount: number }
  | { type: "setTotalBudget"; amount: number }
  | { type: "rebalanceBudget" }
  | { type: "moveBudget"; from: string; to: string; amount: number }
  | { type: "setBudgetReview"; review: BudgetReview }
  | {
      type: "updateVendor";
      id: string;
      patch: Partial<Pick<Vendor, "status" | "quote" | "contact" | "notes">>;
    }
  | { type: "addVendor"; label: string; category?: BudgetCategory | null; why?: string }
  | { type: "removeVendor"; id: string }
  | { type: "setVendorBrief"; id: string; brief: VendorBrief }
  | { type: "toggleVendorCheck"; vendorId: string; checkId: string }
  | { type: "setIdeas"; ideas: readonly Omit<Idea, "id" | "saved">[] }
  | { type: "toggleIdeaSaved"; id: string }
  | { type: "setRunSheet"; items: readonly RunSheetItem[] }
  | { type: "appendChat"; message: Omit<ChatMessage, "id"> }
  | { type: "applyProposal"; messageId: string; index: number }
  | { type: "dismissProposal"; messageId: string; index: number }
  | { type: "applyPersonalization"; payload: PersonalizationPayload };

function nextId(plan: Plan, prefix: string): { id: string; seq: number } {
  const seq = plan.seq + 1;
  return { id: `${prefix}-x${seq}`, seq };
}

function isValidAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount >= 0;
}

function addTask(
  plan: Plan,
  action: { title: string; due: string; why?: string; source?: "ai" | "you" },
  today: string,
): Plan {
  const title = action.title.trim();
  if (!title) return plan;
  const { id, seq } = nextId(plan, "task");
  return {
    ...plan,
    seq,
    tasks: [
      ...plan.tasks,
      {
        id,
        title,
        due: clampDate(action.due, today, plan.brief.date),
        done: false,
        source: action.source ?? "you",
        ...(action.why ? { why: action.why } : {}),
      },
    ],
  };
}

function addVendor(
  plan: Plan,
  action: {
    label: string;
    category?: BudgetCategory | null;
    why?: string;
    source?: "ai" | "you";
    bookBy?: string;
  },
  today: string,
): Plan {
  const label = action.label.trim();
  if (!label) return plan;
  const { id, seq } = nextId(plan, "vendor");
  return {
    ...plan,
    seq,
    vendors: [
      ...plan.vendors,
      {
        id,
        label,
        category: action.category ?? null,
        status: "to-contact",
        // With no suggested date, a vendor added mid-plan is due now.
        bookBy: clampDate(action.bookBy ?? today, today, plan.brief.date),
        quote: null,
        contact: "",
        notes: "",
        source: action.source ?? "you",
        ...(action.why ? { why: action.why } : {}),
        checks: checksFor(action.category ?? null),
      },
    ],
  };
}

function withoutProposal(plan: Plan, messageId: string, index: number): Plan {
  return {
    ...plan,
    chat: plan.chat.map((message) =>
      message.id === messageId
        ? { ...message, proposals: message.proposals?.filter((_, i) => i !== index) ?? [] }
        : message,
    ),
  };
}

function applyProposal(plan: Plan, proposal: PlanProposal, today: string): Plan {
  switch (proposal.type) {
    case "addTask":
      return addTask(plan, { ...proposal, source: "ai" }, today);
    case "addVendor":
      return addVendor(plan, { ...proposal, source: "ai" }, today);
    case "moveBudget": {
      const lines = applyBudgetMove(plan.budgetLines, proposal);
      return lines ? { ...plan, budgetLines: lines } : plan;
    }
  }
}

/**
 * The single place a plan changes. Invalid actions return the plan unchanged, so
 * a stale or hallucinated id is a no-op rather than a corrupted plan.
 */
export function planReducer(plan: Plan, action: PlanAction, today: string): Plan {
  switch (action.type) {
    case "toggleTask":
      return {
        ...plan,
        tasks: plan.tasks.map((task) =>
          task.id === action.id ? { ...task, done: !task.done } : task,
        ),
      };
    case "addTask":
      return addTask(plan, action, today);
    case "removeTask":
      return { ...plan, tasks: plan.tasks.filter((task) => task.id !== action.id) };
    case "setLineAllocated":
      if (!isValidAmount(action.amount)) return plan;
      return {
        ...plan,
        budgetLines: plan.budgetLines.map((line) =>
          line.id === action.id ? { ...line, allocated: Math.round(action.amount) } : line,
        ),
      };
    case "setLineSpent":
      if (!isValidAmount(action.amount)) return plan;
      return {
        ...plan,
        budgetLines: plan.budgetLines.map((line) =>
          line.id === action.id ? { ...line, spent: Math.round(action.amount) } : line,
        ),
      };
    case "setTotalBudget":
      if (!isValidAmount(action.amount) || action.amount === 0) return plan;
      return {
        ...plan,
        brief: { ...plan.brief, budget: action.amount },
        budgetLines: rebalanceLines(plan.budgetLines, action.amount),
      };
    case "rebalanceBudget":
      return { ...plan, budgetLines: rebalanceLines(plan.budgetLines, plan.brief.budget) };
    case "moveBudget": {
      const lines = applyBudgetMove(plan.budgetLines, action);
      return lines ? { ...plan, budgetLines: lines } : plan;
    }
    case "setBudgetReview":
      return { ...plan, budgetReview: action.review };
    case "updateVendor":
      return {
        ...plan,
        vendors: plan.vendors.map((vendor) =>
          vendor.id === action.id ? { ...vendor, ...action.patch } : vendor,
        ),
      };
    case "addVendor":
      return addVendor(plan, action, today);
    case "removeVendor":
      return { ...plan, vendors: plan.vendors.filter((vendor) => vendor.id !== action.id) };
    case "setVendorBrief":
      return {
        ...plan,
        vendors: plan.vendors.map((vendor) =>
          vendor.id === action.id ? { ...vendor, brief: action.brief } : vendor,
        ),
      };
    case "toggleVendorCheck":
      return {
        ...plan,
        vendors: plan.vendors.map((vendor) =>
          vendor.id === action.vendorId
            ? {
                ...vendor,
                checks: vendor.checks.map((check) =>
                  check.id === action.checkId ? { ...check, done: !check.done } : check,
                ),
              }
            : vendor,
        ),
      };
    case "setIdeas": {
      // Saved ideas survive a regenerate; everything unsaved is replaced.
      const saved = plan.ideas.filter((idea) => idea.saved);
      let seq = plan.seq;
      const fresh = action.ideas.map((idea): Idea => {
        seq += 1;
        return { ...idea, id: `idea-x${seq}`, saved: false };
      });
      return { ...plan, seq, ideas: [...saved, ...fresh] };
    }
    case "toggleIdeaSaved":
      return {
        ...plan,
        ideas: plan.ideas.map((idea) =>
          idea.id === action.id ? { ...idea, saved: !idea.saved } : idea,
        ),
      };
    case "setRunSheet":
      return { ...plan, runSheet: [...action.items] };
    case "appendChat": {
      const { id, seq } = nextId(plan, "msg");
      const chat = [...plan.chat, { ...action.message, id }];
      return { ...plan, seq, chat: chat.slice(-MAX_CHAT_MESSAGES) };
    }
    case "applyProposal": {
      const message = plan.chat.find((m) => m.id === action.messageId);
      const proposal = message?.proposals?.[action.index];
      if (!proposal) return plan;
      return withoutProposal(applyProposal(plan, proposal, today), action.messageId, action.index);
    }
    case "dismissProposal":
      return withoutProposal(plan, action.messageId, action.index);
    case "applyPersonalization": {
      const { payload } = action;
      let next = plan;
      for (const task of payload.tasks) {
        next = addTask(next, { ...task, source: "ai" }, today);
      }
      for (const vendor of payload.vendors) {
        next = addVendor(next, { ...vendor, source: "ai" }, today);
      }
      return {
        ...next,
        personalization: {
          summary: payload.summary,
          reasoning: payload.reasoning,
          source: payload.source,
        },
      };
    }
  }
}
