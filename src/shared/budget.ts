/**
 * Budget arithmetic. Money is never the model's job: allocation, rebalancing and
 * over-spend detection are all deterministic so the totals are always exact, and
 * the AI only ever proposes moves that this module validates and applies.
 */
import { CONTINGENCY_SHARE, EVENT_TEMPLATES } from "./templates.js";
import type { BudgetCategory, BudgetLine, BudgetMove, Brief, Plan } from "./schemas.js";

/** Weight multiplier for a category the user said matters most. */
const PRIORITY_BOOST = 1.5;

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

/**
 * Split `total` across weights in whole units using the largest-remainder
 * method, so the parts always sum to exactly the total with no rounding drift.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const whole = Math.round(total);
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    return allocate(
      whole,
      weights.map(() => 1),
    );
  }
  const exact = weights.map((w) => (w / sum) * whole);
  const parts = exact.map(Math.floor);
  const leftover = whole - parts.reduce((acc, p) => acc + p, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < leftover; i += 1) {
    const target = byRemainder[i % byRemainder.length];
    if (target) parts[target.index] = (parts[target.index] ?? 0) + 1;
  }
  return parts;
}

/** Build the opening budget from the event template and the user's priorities. */
export function buildBudgetLines(
  brief: Pick<Brief, "eventType" | "budget" | "priorities">,
): BudgetLine[] {
  const template = EVENT_TEMPLATES[brief.eventType].budget;
  const priorities = new Set<BudgetCategory>(brief.priorities);
  const weights = template.map((line) =>
    priorities.has(line.category) ? line.share * PRIORITY_BOOST : line.share,
  );
  const contingency = Math.round(brief.budget * CONTINGENCY_SHARE);
  const amounts = allocate(brief.budget - contingency, weights);

  const lines: BudgetLine[] = template.map((line, index) => ({
    id: line.category,
    category: line.category,
    label: line.label,
    allocated: amounts[index] ?? 0,
    spent: 0,
  }));
  lines.push({
    id: "contingency",
    category: "contingency",
    label: "Contingency",
    allocated: contingency,
    spent: 0,
  });
  return lines;
}

interface BudgetLineSummary extends BudgetLine {
  /** Manual spend plus every booked or paid vendor's quote on this line. */
  committed: number;
  remaining: number;
  /** committed ÷ allocated, as a whole percentage (may exceed 100). */
  usedPercent: number;
  over: boolean;
}

export interface BudgetSummary {
  total: number;
  allocated: number;
  /** Positive: money not yet assigned. Negative: lines exceed the total. */
  unallocated: number;
  committed: number;
  remaining: number;
  perGuest: number;
  usedPercent: number;
  over: boolean;
  lines: BudgetLineSummary[];
}

function committedByLine(plan: Pick<Plan, "vendors">): Map<string, number> {
  const totals = new Map<string, number>();
  for (const vendor of plan.vendors) {
    const counts = vendor.status === "booked" || vendor.status === "paid";
    if (!counts || vendor.quote === null || vendor.category === null) continue;
    totals.set(vendor.category, (totals.get(vendor.category) ?? 0) + vendor.quote);
  }
  return totals;
}

export function summarizeBudget(
  plan: Pick<Plan, "brief" | "budgetLines" | "vendors">,
): BudgetSummary {
  const vendorTotals = committedByLine(plan);
  const lines = plan.budgetLines.map((line): BudgetLineSummary => {
    const committed = line.spent + (line.category ? (vendorTotals.get(line.category) ?? 0) : 0);
    return {
      ...line,
      committed,
      remaining: line.allocated - committed,
      usedPercent: line.allocated > 0 ? Math.round((committed / line.allocated) * 100) : 0,
      over: committed > line.allocated,
    };
  });
  const allocated = lines.reduce((acc, line) => acc + line.allocated, 0);
  const committed = lines.reduce((acc, line) => acc + line.committed, 0);
  const total = plan.brief.budget;
  return {
    total,
    allocated,
    unallocated: total - allocated,
    committed,
    remaining: total - committed,
    perGuest: plan.brief.guests > 0 ? Math.round(total / plan.brief.guests) : 0,
    usedPercent: total > 0 ? Math.round((committed / total) * 100) : 0,
    over: committed > total,
    lines,
  };
}

/** Scale every line proportionally so the lines sum to exactly `total`. */
export function rebalanceLines(lines: readonly BudgetLine[], total: number): BudgetLine[] {
  const amounts = allocate(
    total,
    lines.map((line) => line.allocated),
  );
  return lines.map((line, index) => ({ ...line, allocated: amounts[index] ?? 0 }));
}

/**
 * Apply a move only if it is real: both lines exist, they differ, and the source
 * can cover it. Returns null otherwise, so a hallucinated line id or an
 * impossible amount can never corrupt the budget.
 */
export function applyBudgetMove(
  lines: readonly BudgetLine[],
  move: Pick<BudgetMove, "from" | "to" | "amount">,
): BudgetLine[] | null {
  if (move.from === move.to || !(move.amount > 0)) return null;
  const from = lines.find((line) => line.id === move.from);
  const to = lines.find((line) => line.id === move.to);
  if (!from || !to || move.amount > from.allocated) return null;
  return lines.map((line) => {
    if (line.id === move.from) return { ...line, allocated: line.allocated - move.amount };
    if (line.id === move.to) return { ...line, allocated: line.allocated + move.amount };
    return line;
  });
}
