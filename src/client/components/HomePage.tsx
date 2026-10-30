import { useRef, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  Lightbulb,
  Trash2,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { formatMoney } from "../../shared/budget";
import { formatDate, todayIso } from "../../shared/dates";
import { computeReadiness, countdownLabel, daysToGo } from "../../shared/insights";
import { EVENT_TEMPLATES } from "../../shared/templates";
import type { Plan } from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { MAX_IMPORT_BYTES, parsePlanBackup, type PlanStore } from "../lib/plan-store";
import { navigate, planHref } from "../lib/route";
import { IntakeFlow } from "./IntakeFlow";
import { EVENT_ICONS, ProgressBar } from "./ui";

const CAPABILITIES = [
  { icon: Wallet, title: "Budgets", text: "Split by what matters to you, and it always adds up." },
  { icon: CalendarClock, title: "Timelines", text: "Scheduled back from your date." },
  {
    icon: ClipboardCheck,
    title: "Vendor checklists",
    text: "Who to book, by when, and what to ask.",
  },
  { icon: Lightbulb, title: "Personalised ideas", text: "Made for your people, not a template." },
] as const;

function SavedPlanCard({ plan, onRemove }: { plan: Plan; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const days = daysToGo(plan, todayIso());
  const { brief } = plan;
  const Icon = EVENT_ICONS[brief.eventType];
  const { score } = computeReadiness(plan);
  return (
    <li className="plan-card" data-event={brief.eventType}>
      <span className="plan-card-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div className="plan-card-body">
        <h3>
          <a href={planHref(plan.id)}>{brief.title}</a>
        </h3>
        <p className="plan-card-meta">
          {EVENT_TEMPLATES[brief.eventType].label} · {countdownLabel(days)}
        </p>
        <p className="plan-card-meta">
          <CalendarDays aria-hidden="true" size={14} /> {formatDate(brief.date)}
          <Users aria-hidden="true" size={14} /> {brief.guests} guests ·{" "}
          {formatMoney(brief.budget, brief.currency)}
        </p>
        <ProgressBar value={score} label={`${brief.title} readiness`} />
      </div>
      {confirming ? (
        <div className="inline-confirm">
          <button type="button" className="button button-danger" onClick={onRemove}>
            Delete {brief.title}
          </button>
          <button type="button" className="button" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete ${brief.title}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden="true" size={18} />
        </button>
      )}
    </li>
  );
}

export function HomePage({ store, plans }: { store: PlanStore; plans: readonly Plan[] }) {
  const announce = useAnnounce();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");

  async function importBackup(file: File): Promise<void> {
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError("That file is too large to be a Grace backup.");
      return;
    }
    const result = parsePlanBackup(await file.text());
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportError("");
    store.add(result.plan);
    announce(`Imported ${result.plan.brief.title}`);
    navigate(planHref(result.plan.id));
  }

  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero-inner">
          <p className="hero-eyebrow">Weddings · Birthdays · Community events</p>
          <h1 id="hero-title">
            Plan the day.
            <br />
            <em>Enjoy the day.</em>
          </h1>
          <p className="hero-lead">
            Tell Grace about your celebration, in your own words. You get a budget, a timeline, a
            vendor checklist and ideas made for your event, not a generic template.
          </p>
          <ul className="capabilities">
            {CAPABILITIES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="capability">
                <Icon aria-hidden="true" size={20} />
                <span>
                  <strong>{title}</strong>
                  {text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="container home-body">
        <IntakeFlow store={store} />

        <section className="saved-plans" aria-labelledby="saved-title">
          <div className="section-heading">
            <h2 id="saved-title">Your events</h2>
            <button type="button" className="button" onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden="true" size={16} />
              Import backup
            </button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              aria-label="Import a Grace plan backup"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBackup(file);
                event.target.value = "";
              }}
            />
          </div>
          {importError ? (
            <p className="callout callout-danger" role="alert">
              {importError}
            </p>
          ) : null}
          {plans.length === 0 ? (
            <p className="empty-note">
              Nothing here yet. Your first plan will appear here, in this browser only.
            </p>
          ) : (
            <ul className="plan-list">
              {plans.map((plan) => (
                <SavedPlanCard
                  key={plan.id}
                  plan={plan}
                  onRemove={() => {
                    store.remove(plan.id);
                    announce(`Deleted ${plan.brief.title}`);
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
