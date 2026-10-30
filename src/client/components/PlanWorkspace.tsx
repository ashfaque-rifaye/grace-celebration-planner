import { lazy, Suspense, useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import {
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  LayoutDashboard,
  Lightbulb,
  MapPin,
  MessageCircle,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { formatMoney } from "../../shared/budget";
import { addDays, formatDate, todayIso } from "../../shared/dates";
import { countdownParts, daysToGo, type PlanTab } from "../../shared/insights";
import type { PlanAction } from "../../shared/plan";
import type { Plan } from "../../shared/schemas";
import { clampDate } from "../../shared/timeline";
import { EVENT_TEMPLATES } from "../../shared/templates";
import type { PlanStore } from "../lib/plan-store";
import { navigate, PLAN_TABS, planHref } from "../lib/route";
import { useAi } from "../lib/use-ai";
import { OverviewPanel } from "./OverviewPanel";
import { EVENT_ICONS } from "./ui";

const TAB_ICONS: Record<PlanTab, LucideIcon> = {
  overview: LayoutDashboard,
  budget: Wallet,
  timeline: CalendarRange,
  vendors: ClipboardCheck,
  ideas: Lightbulb,
  assistant: MessageCircle,
};

const BudgetPanel = lazy(() => import("./BudgetPanel"));
const TimelinePanel = lazy(() => import("./TimelinePanel"));
const VendorsPanel = lazy(() => import("./VendorsPanel"));
const IdeasPanel = lazy(() => import("./IdeasPanel"));
const AssistantPanel = lazy(() => import("./AssistantPanel"));

export interface PanelProps {
  plan: Plan;
  today: string;
  dispatch: (action: PlanAction) => void;
}

function renderDetailPanel(tab: Exclude<PlanTab, "overview">, props: PanelProps) {
  switch (tab) {
    case "budget":
      return <BudgetPanel {...props} />;
    case "timeline":
      return <TimelinePanel {...props} />;
    case "vendors":
      return <VendorsPanel {...props} />;
    case "ideas":
      return <IdeasPanel {...props} />;
    case "assistant":
      return <AssistantPanel {...props} />;
  }
}

export function PlanWorkspace({
  plan,
  tab,
  store,
}: {
  plan: Plan;
  tab: PlanTab;
  store: PlanStore;
}) {
  const today = todayIso();
  const dispatch = useCallback(
    (action: PlanAction) => store.dispatch(plan.id, action),
    [store, plan.id],
  );
  const tabRefs = useRef(new Map<PlanTab, HTMLButtonElement>());
  const { state: personalizeState, run: personalize } = useAi("personalize");

  // Every new plan gets one AI pass that layers event-specific tasks and vendors
  // over the deterministic skeleton. The plan is already usable while this runs.
  // A re-run simply supersedes the previous request, and the server caches it.
  useEffect(() => {
    if (plan.personalization) return;
    void personalize({ brief: plan.brief }).then((envelope) => {
      if (!envelope) return;
      const { summary, reasoning, tasks, vendors } = envelope.data;
      dispatch({
        type: "applyPersonalization",
        payload: {
          summary,
          reasoning,
          source: envelope.source,
          tasks: tasks.map(({ title, daysBefore, why }) => ({
            title,
            why,
            due: clampDate(addDays(plan.brief.date, -daysBefore), today, plan.brief.date),
          })),
          vendors: vendors.map(({ label, category, daysBefore, why }) => ({
            label,
            category,
            why,
            bookBy: clampDate(addDays(plan.brief.date, -daysBefore), today, plan.brief.date),
          })),
        },
      });
    });
  }, [plan.personalization, plan.brief, personalize, dispatch, today]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const index = PLAN_TABS.findIndex((candidate) => candidate.id === tab);
    const last = PLAN_TABS.length - 1;
    const target =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const next = PLAN_TABS[target];
    if (!next) return;
    event.preventDefault();
    navigate(planHref(plan.id, next.id));
    tabRefs.current.get(next.id)?.focus();
  }

  const countdown = countdownParts(daysToGo(plan, today));
  const { brief } = plan;
  const EventIcon = EVENT_ICONS[brief.eventType];

  return (
    <div className="workspace" data-event={brief.eventType}>
      <div className="plan-hero">
        <div className="container plan-hero-inner">
          <div>
            <p className="hero-eyebrow">
              <EventIcon aria-hidden="true" size={16} />
              {EVENT_TEMPLATES[brief.eventType].label}
            </p>
            <h1>{brief.title}</h1>
            <ul className="plan-facts">
              <li>
                <CalendarDays aria-hidden="true" size={16} />
                {formatDate(brief.date)}
              </li>
              {brief.city ? (
                <li>
                  <MapPin aria-hidden="true" size={16} />
                  {brief.city}
                </li>
              ) : null}
              <li>
                <Users aria-hidden="true" size={16} />
                {brief.guests} guests
              </li>
              <li>
                <Wallet aria-hidden="true" size={16} />
                {formatMoney(brief.budget, brief.currency)}
              </li>
            </ul>
          </div>
          <p className="countdown">
            <strong>{countdown.value}</strong>
            {countdown.unit ? <span>{countdown.unit}</span> : null}
          </p>
        </div>
      </div>

      <div className="tabs-bar no-print">
        <div className="container">
          <div className="tabs" role="tablist" aria-label="Plan sections">
            {PLAN_TABS.map(({ id, label }) => {
              const Icon = TAB_ICONS[id];
              return (
                <button
                  key={id}
                  ref={(element) => {
                    if (element) tabRefs.current.set(id, element);
                    else tabRefs.current.delete(id);
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  className="tab"
                  onClick={() => {
                    navigate(planHref(plan.id, id));
                  }}
                  onKeyDown={onTabKeyDown}
                >
                  <Icon aria-hidden="true" size={17} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        key={tab}
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="panel container"
      >
        <Suspense fallback={<p role="status">Loading…</p>}>
          {tab === "overview" ? (
            <OverviewPanel
              plan={plan}
              today={today}
              dispatch={dispatch}
              personalizing={personalizeState.status === "loading"}
              personalizeError={
                personalizeState.status === "error" ? personalizeState.message : null
              }
            />
          ) : (
            renderDetailPanel(tab, { plan, today, dispatch })
          )}
        </Suspense>
      </div>
    </div>
  );
}
