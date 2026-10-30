/**
 * Deterministic plan health: readiness score, risks and next best actions.
 *
 * None of this needs a model, because it is arithmetic over the user's own data,
 * and it must stay correct when no model is available. Each risk carries a "why"
 * so the score is explainable rather than a mystery number.
 */
import { summarizeBudget, formatMoney } from "./budget";
import { daysBetween, formatDate } from "./dates";
import { isOverdue } from "./timeline";
import type { Plan, Task, Vendor } from "./schemas";

export type PlanTab = "overview" | "budget" | "timeline" | "vendors" | "ideas" | "assistant";

export interface Risk {
  id: string;
  severity: "high" | "medium";
  title: string;
  why: string;
  tab: PlanTab;
}

export interface Readiness {
  score: number;
  tasksPart: number;
  vendorsPart: number;
  budgetPart: number;
  tasksDone: number;
  tasksTotal: number;
  vendorsBooked: number;
  vendorsTotal: number;
}

const WEIGHT = { tasks: 0.4, vendors: 0.35, budget: 0.25 } as const;

export function isVendorSecured(vendor: Pick<Vendor, "status">): boolean {
  return vendor.status === "booked" || vendor.status === "paid";
}

export function computeReadiness(plan: Plan): Readiness {
  const tasksDone = plan.tasks.filter((task) => task.done).length;
  const vendorsBooked = plan.vendors.filter(isVendorSecured).length;
  const budget = summarizeBudget(plan);

  const tasksPart = plan.tasks.length ? tasksDone / plan.tasks.length : 1;
  const vendorsPart = plan.vendors.length ? vendorsBooked / plan.vendors.length : 1;
  // A budget earns full marks while it covers commitments, and loses them in
  // proportion to the overspend.
  const budgetPart = budget.over ? Math.max(0, 2 - budget.committed / budget.total) : 1;

  const score = Math.round(
    100 * (WEIGHT.tasks * tasksPart + WEIGHT.vendors * vendorsPart + WEIGHT.budget * budgetPart),
  );

  return {
    score,
    tasksPart,
    vendorsPart,
    budgetPart,
    tasksDone,
    tasksTotal: plan.tasks.length,
    vendorsBooked,
    vendorsTotal: plan.vendors.length,
  };
}

export function detectRisks(plan: Plan, today: string): Risk[] {
  const risks: Risk[] = [];
  const { currency } = plan.brief;
  const budget = summarizeBudget(plan);

  const overdue = plan.tasks.filter((task) => isOverdue(task, today));
  if (overdue.length > 0) {
    risks.push({
      id: "tasks-overdue",
      severity: overdue.length >= 3 ? "high" : "medium",
      title: `${overdue.length} overdue ${overdue.length === 1 ? "task" : "tasks"}`,
      why: `The oldest, "${overdue[0]?.title ?? ""}", was due ${formatDate(overdue[0]?.due ?? today)}.`,
      tab: "timeline",
    });
  }

  const lateVendors = plan.vendors.filter(
    (vendor) => !isVendorSecured(vendor) && vendor.bookBy < today,
  );
  if (lateVendors.length > 0) {
    risks.push({
      id: "vendors-late",
      severity: "high",
      title: `${lateVendors.length} ${lateVendors.length === 1 ? "vendor" : "vendors"} past the book-by date`,
      why: `${lateVendors.map((vendor) => vendor.label).join(", ")} should already be secured. Good suppliers get booked early.`,
      tab: "vendors",
    });
  }

  if (budget.over) {
    risks.push({
      id: "budget-over",
      severity: "high",
      title: "Commitments exceed the total budget",
      why: `You have committed ${formatMoney(budget.committed, currency)} against ${formatMoney(budget.total, currency)}.`,
      tab: "budget",
    });
  }

  const overLines = budget.lines.filter((line) => line.over);
  if (overLines.length > 0 && !budget.over) {
    risks.push({
      id: "lines-over",
      severity: "medium",
      title: `${overLines.length} budget ${overLines.length === 1 ? "line is" : "lines are"} over`,
      why: `${overLines.map((line) => `${line.label} by ${formatMoney(-line.remaining, currency)}`).join("; ")}. Move money across or trim the scope.`,
      tab: "budget",
    });
  }

  if (budget.unallocated < 0) {
    risks.push({
      id: "budget-overallocated",
      severity: "medium",
      title: "Budget lines add up to more than your total",
      why: `Lines exceed the total by ${formatMoney(-budget.unallocated, currency)}. Rebalance to fix this in one click.`,
      tab: "budget",
    });
  }

  return risks.sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high"));
}

export interface NextAction {
  id: string;
  kind: "task" | "vendor";
  title: string;
  due: string;
  overdue: boolean;
}

/** The most urgent open work: tasks and bookings in one due-date order. */
export function nextActions(plan: Plan, today: string, limit = 3): NextAction[] {
  const fromTasks = plan.tasks
    .filter((task: Task) => !task.done)
    .map((task): NextAction => ({
      id: task.id,
      kind: "task",
      title: task.title,
      due: task.due,
      overdue: task.due < today,
    }));
  const fromVendors = plan.vendors
    .filter((vendor) => !isVendorSecured(vendor))
    .map((vendor): NextAction => ({
      id: vendor.id,
      kind: "vendor",
      title: `Book: ${vendor.label}`,
      due: vendor.bookBy,
      overdue: vendor.bookBy < today,
    }));
  return [...fromTasks, ...fromVendors]
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function daysToGo(plan: Plan, today: string): number {
  return daysBetween(today, plan.brief.date);
}

/** The countdown split into a headline value and its unit, for large display. */
export function countdownParts(days: number): { value: string; unit: string } {
  if (days > 1) return { value: String(days), unit: "days to go" };
  return { value: countdownLabel(days), unit: "" };
}

export function countdownLabel(days: number): string {
  if (days < 0) {
    const ago = -days;
    return `${ago} ${ago === 1 ? "day" : "days"} ago`;
  }
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days to go`;
}
