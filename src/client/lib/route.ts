/**
 * Hash routing, in about thirty lines. The app has two screens, so a router
 * library would add weight without adding anything, and hash URLs work on any
 * static host with no rewrite rules.
 */
import type { PlanTab } from "../../shared/insights";

export const PLAN_TABS: readonly { id: PlanTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "budget", label: "Budget" },
  { id: "timeline", label: "Timeline" },
  { id: "vendors", label: "Vendors" },
  { id: "ideas", label: "Ideas" },
  { id: "assistant", label: "Ask Grace" },
];

export type Route = { name: "home" } | { name: "plan"; planId: string; tab: PlanTab };

export function parseRoute(hash: string): Route {
  const match = /^#\/plans\/([\w-]{1,64})(?:\/([a-z]+))?$/.exec(hash);
  if (!match?.[1]) return { name: "home" };
  const tab = PLAN_TABS.find((candidate) => candidate.id === match[2])?.id ?? "overview";
  return { name: "plan", planId: match[1], tab };
}

export function planHref(planId: string, tab: PlanTab = "overview"): string {
  return `#/plans/${planId}/${tab}`;
}

export function navigate(href: string): void {
  window.location.hash = href;
}
