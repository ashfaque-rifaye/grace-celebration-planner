/**
 * Build the minimal view of a plan that is sent to the AI.
 *
 * This is the privacy boundary: vendor contact details and notes are not copied,
 * so they cannot leave the browser no matter what the model is asked.
 */
import { summarizeBudget } from "./budget";
import { daysToGo, detectRisks } from "./insights";
import { isOverdue } from "./timeline";
import type { PlanContext } from "./contracts";
import type { Plan } from "./schemas";

const MAX_OPEN_TASKS = 15;

export function buildPlanContext(plan: Plan, today: string): PlanContext {
  const { brief } = plan;
  const budget = summarizeBudget(plan);
  return {
    today,
    daysToGo: daysToGo(plan, today),
    title: brief.title,
    eventType: brief.eventType,
    date: brief.date,
    guests: brief.guests,
    city: brief.city,
    vibe: brief.vibe,
    notes: brief.notes,
    currency: brief.currency,
    language: brief.language,
    budgetTotal: brief.budget,
    budgetLines: budget.lines.map(({ id, label, allocated, committed }) => ({
      id,
      label,
      allocated,
      committed,
    })),
    openTasks: plan.tasks
      .filter((task) => !task.done)
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, MAX_OPEN_TASKS)
      .map(({ title, due }) => ({ title, due })),
    overdueTasks: plan.tasks.filter((task) => isOverdue(task, today)).length,
    vendors: plan.vendors.slice(0, 30).map(({ label, status, bookBy }) => ({
      label,
      status,
      bookBy,
    })),
    risks: detectRisks(plan, today)
      .slice(0, 8)
      .map((risk) => risk.title),
  };
}
