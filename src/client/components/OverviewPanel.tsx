import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  ListChecks,
  Printer,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { formatDate } from "../../shared/dates";
import { formatMoney, summarizeBudget } from "../../shared/budget";
import { planToJson } from "../../shared/exports";
import { computeReadiness, detectRisks, nextActions } from "../../shared/insights";
import { useAnnounce } from "../lib/announcer";
import { downloadText, slugify } from "../lib/download";
import { planHref } from "../lib/route";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Loading, ProgressRing, Stat, Why } from "./ui";

interface OverviewProps extends PanelProps {
  personalizing?: boolean;
  personalizeError?: string | null;
}

export function OverviewPanel({
  plan,
  today,
  dispatch,
  personalizing = false,
  personalizeError = null,
}: OverviewProps) {
  const announce = useAnnounce();
  const readiness = computeReadiness(plan);
  const risks = detectRisks(plan, today);
  const actions = nextActions(plan, today);
  const budget = summarizeBudget(plan);
  const { currency, language } = plan.brief;
  const aiTasks = plan.tasks.filter((task) => task.source === "ai");
  const aiVendors = plan.vendors.filter((vendor) => vendor.source === "ai");

  return (
    <div className="stack">
      <h2 className="sr-only">Overview</h2>

      <section className="card readiness" aria-labelledby="readiness-title">
        <ProgressRing value={readiness.score} label="Overall readiness" />
        <div className="readiness-body">
          <h3 id="readiness-title">Readiness: {readiness.score}%</h3>
          <p className="muted">
            Tasks finished, vendors booked and a budget that covers what you have committed.
          </p>
          <dl className="stat-grid">
            <Stat
              icon={ListChecks}
              label="Tasks done"
              value={`${readiness.tasksDone} of ${readiness.tasksTotal}`}
            />
            <Stat
              icon={ClipboardCheck}
              label="Vendors booked"
              value={`${readiness.vendorsBooked} of ${readiness.vendorsTotal}`}
            />
            <Stat
              icon={Wallet}
              label="Committed"
              value={formatMoney(budget.committed, currency)}
              detail={`of ${formatMoney(budget.total, currency)}`}
            />
            <Stat
              icon={Users}
              label="Budget per guest"
              value={formatMoney(budget.perGuest, currency)}
            />
          </dl>
        </div>
      </section>

      <div aria-live="polite">
        {personalizing ? <Loading>Grace is tailoring your plan…</Loading> : null}
        {personalizeError ? <ErrorNote message={personalizeError} /> : null}
        {plan.personalization ? (
          <section
            className="card card-ai"
            aria-labelledby="tailored-title"
            data-testid="personalization"
          >
            <div className="card-heading">
              <h3 id="tailored-title">
                <Sparkles aria-hidden="true" size={18} /> Tailored for this event
              </h3>
              <AiBadge meta={plan.personalization} />
            </div>
            <p lang={language}>{plan.personalization.summary}</p>
            <Why text={plan.personalization.reasoning} language={language} />
            {aiTasks.length + aiVendors.length > 0 ? (
              <ul className="tailored-list">
                {aiTasks.map((task) => (
                  <li key={task.id}>
                    <strong lang={language}>{task.title}</strong>{" "}
                    <span className="muted">Task, due {formatDate(task.due)}</span>
                    {task.why ? <Why text={task.why} language={language} /> : null}
                  </li>
                ))}
                {aiVendors.map((vendor) => (
                  <li key={vendor.id}>
                    <strong lang={language}>{vendor.label}</strong>{" "}
                    <span className="muted">Added to vendors</span>
                    {vendor.why ? <Why text={vendor.why} language={language} /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="two-column">
        <section className="card" aria-labelledby="risks-title">
          <h3 id="risks-title">Risks to watch</h3>
          {risks.length === 0 ? (
            <p className="callout callout-ok">
              <CheckCircle2 aria-hidden="true" size={18} /> Nothing needs attention right now.
            </p>
          ) : (
            <ul className="risk-list">
              {risks.map((risk) => (
                <li key={risk.id} className={`risk risk-${risk.severity}`}>
                  <AlertTriangle aria-hidden="true" size={18} />
                  <div>
                    <p>
                      <strong>{risk.severity === "high" ? "High: " : "Watch: "}</strong>
                      {risk.title}
                    </p>
                    <p className="muted">{risk.why}</p>
                    <a href={planHref(plan.id, risk.tab)}>
                      Open {risk.tab} <ArrowRight aria-hidden="true" size={14} />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="next-title">
          <h3 id="next-title">Do these next</h3>
          {actions.length === 0 ? (
            <p>Everything is done. Enjoy your event.</p>
          ) : (
            <ul className="action-list">
              {actions.map((action) => (
                <li key={action.id}>
                  {action.kind === "task" ? (
                    <label className="checkbox-option">
                      <input
                        type="checkbox"
                        onChange={() => {
                          dispatch({ type: "toggleTask", id: action.id });
                          announce(`Done: ${action.title}`);
                        }}
                      />
                      <span>{action.title}</span>
                    </label>
                  ) : (
                    <a href={planHref(plan.id, "vendors")}>{action.title}</a>
                  )}
                  <span className={action.overdue ? "tag tag-danger" : "tag"}>
                    {action.overdue ? "Overdue: " : "By "}
                    {formatDate(action.due)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="button-row no-print">
        <button
          type="button"
          className="button"
          onClick={() => {
            downloadText(
              `${slugify(plan.brief.title)}-plan.json`,
              planToJson(plan),
              "application/json",
            );
            announce("Backup downloaded");
          }}
        >
          <Download aria-hidden="true" size={16} />
          Download backup
        </button>
        <button type="button" className="button" onClick={() => window.print()}>
          <Printer aria-hidden="true" size={16} />
          Print this page
        </button>
      </div>
    </div>
  );
}
