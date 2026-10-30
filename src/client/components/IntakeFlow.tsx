import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { MAX_BRIEF_TEXT, type BriefDraft } from "../../shared/contracts";
import { todayIso } from "../../shared/dates";
import { LANGUAGE_NAMES } from "../../shared/languages";
import { createPlan } from "../../shared/plan";
import {
  briefSchema,
  CURRENCIES,
  EVENT_TYPES,
  LANGUAGES,
  MAX_PRIORITIES,
  type BudgetCategory,
  type Brief,
  type Currency,
  type EventType,
  type Language,
} from "../../shared/schemas";
import { EVENT_TEMPLATES } from "../../shared/templates";
import { useAnnounce } from "../lib/announcer";
import type { PlanStore } from "../lib/plan-store";
import { navigate, planHref } from "../lib/route";
import { useAi } from "../lib/use-ai";
import { AiBadge, describedBy, ErrorNote, EVENT_ICONS, Field, Loading, Why } from "./ui";

const EXAMPLES: readonly { label: string; text: string }[] = [
  {
    label: "A wedding",
    text: "A traditional Tamil wedding in Chennai on 14 February for 300 guests, budget ₹18 lakh. Vegetarian food, and my grandmother uses a wheelchair.",
  },
  {
    label: "A birthday",
    text: "A surprise 40th birthday for my partner on a rooftop in Bengaluru, about 35 friends, budget 80k. He loves jazz and hates speeches.",
  },
  {
    label: "A community event",
    text: "Our neighbourhood's first street food festival in Pune next March, about 800 people, budget ₹3 lakh, run by volunteers. It has to be low waste.",
  },
];

interface FormState {
  title: string;
  eventType: EventType;
  date: string;
  guests: string;
  budget: string;
  currency: Currency;
  city: string;
  vibe: string;
  notes: string;
  priorities: BudgetCategory[];
  language: Language;
}

const EMPTY_FORM: FormState = {
  title: "",
  eventType: "wedding",
  date: "",
  guests: "",
  budget: "",
  currency: "INR",
  city: "",
  vibe: "",
  notes: "",
  priorities: [],
  language: "en",
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

/** Validate the form through the shared schema, plus the rule only "today" can judge. */
export function validateForm(
  form: FormState,
  today: string,
): { brief: Brief; errors?: undefined } | { brief?: undefined; errors: FieldErrors } {
  const toNumber = (value: string) => (value.trim() === "" ? undefined : Number(value));
  const result = briefSchema.safeParse({
    ...form,
    guests: toNumber(form.guests),
    budget: toNumber(form.budget),
  });
  const errors: FieldErrors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormState;
      errors[key] ??= issue.message;
    }
  }
  if (!form.date) errors.date = "Choose the date of your event";
  else if (form.date < today) errors.date = "Choose a date that has not passed";
  if (result.success && Object.keys(errors).length === 0) return { brief: result.data };
  return { errors };
}

function applyDraft(form: FormState, draft: BriefDraft): FormState {
  const next: FormState = {
    ...form,
    ...(draft.title ? { title: draft.title } : {}),
    ...(draft.eventType ? { eventType: draft.eventType } : {}),
    ...(draft.date ? { date: draft.date } : {}),
    ...(draft.guests ? { guests: String(draft.guests) } : {}),
    ...(draft.budget ? { budget: String(draft.budget) } : {}),
    ...(draft.currency ? { currency: draft.currency } : {}),
    ...(draft.city ? { city: draft.city } : {}),
    ...(draft.vibe ? { vibe: draft.vibe } : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
    ...(draft.priorities ? { priorities: draft.priorities } : {}),
  };
  return next;
}

const ERROR_ORDER: readonly (keyof FormState)[] = ["title", "date", "guests", "budget"];

export function IntakeFlow({ store }: { store: PlanStore }) {
  const announce = useAnnounce();
  const [description, setDescription] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Counts failed submits, so each one moves focus even if the errors are unchanged.
  const [failedSubmits, setFailedSubmits] = useState(0);
  const errorSummary = useRef<HTMLDivElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const { state: draftState, run: runDraft } = useAi("brief");
  const today = todayIso();

  // The summary only exists after the errors render, so focus it from an effect.
  useEffect(() => {
    if (failedSubmits > 0) errorSummary.current?.focus();
  }, [failedSubmits]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function draftFromDescription(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (description.trim().length < 3) return;
    const envelope = await runDraft({ text: description });
    if (envelope) {
      setForm((current) => applyDraft(current, envelope.data.brief));
      setErrors({});
      announce("Details filled in. Check them below, then create your plan.");
      formHeading.current?.focus();
    }
  }

  function createFromForm(event: FormEvent): void {
    event.preventDefault();
    const result = validateForm(form, today);
    if (result.errors) {
      setErrors(result.errors);
      setFailedSubmits((count) => count + 1);
      return;
    }
    const id = crypto.randomUUID();
    store.add(createPlan(result.brief, { id, today, now: new Date().toISOString() }));
    navigate(planHref(id));
  }

  const errorEntries = ERROR_ORDER.flatMap((key) => {
    const message = errors[key];
    return message ? [{ key, message }] : [];
  });
  const categories = EVENT_TEMPLATES[form.eventType].budget;
  const prioritiesFull = form.priorities.length >= MAX_PRIORITIES;

  return (
    <div className="intake">
      <section className="card card-raised intake-describe" aria-labelledby="describe-title">
        <p className="step-label">Step 1 · Optional, but it saves typing</p>
        <h2 id="describe-title">
          <Sparkles aria-hidden="true" size={22} /> Describe your event in your own words
        </h2>
        <form onSubmit={(event) => void draftFromDescription(event)}>
          <Field
            id="event-description"
            label="What are you planning?"
            hint="Mention whatever you know: the occasion, date, guests, budget, place, traditions, and who it is for."
          >
            <textarea
              id="event-description"
              rows={4}
              maxLength={MAX_BRIEF_TEXT}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-describedby="event-description-hint"
            />
          </Field>
          <div className="chip-row" role="group" aria-label="Example descriptions">
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                className="chip"
                onClick={() => setDescription(example.text)}
              >
                Try: {example.label}
              </button>
            ))}
          </div>
          <button
            type="submit"
            className="button button-primary"
            disabled={draftState.status === "loading" || description.trim().length < 3}
          >
            <Sparkles aria-hidden="true" size={16} />
            Fill in the details with AI
          </button>
        </form>

        <div aria-live="polite">
          {draftState.status === "loading" ? (
            <Loading>Grace is reading your description…</Loading>
          ) : null}
          {draftState.status === "error" ? <ErrorNote message={draftState.message} /> : null}
          {draftState.status === "success" ? (
            <div className="ai-result" data-testid="brief-result">
              <AiBadge meta={draftState.envelope} />
              <Why text={draftState.envelope.data.reasoning} />
              {draftState.envelope.data.assumptions.length > 0 ? (
                <>
                  <h3>What Grace assumed</h3>
                  <ul>
                    {draftState.envelope.data.assumptions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {draftState.envelope.data.questions.length > 0 ? (
                <>
                  <h3>Still needed from you</h3>
                  <ul>
                    {draftState.envelope.data.questions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby="details-title">
        <p className="step-label">Step 2 · Check the details</p>
        <h2 id="details-title" ref={formHeading} tabIndex={-1}>
          Event details
        </h2>
        <form noValidate onSubmit={createFromForm}>
          {errorEntries.length > 0 ? (
            <div className="callout callout-danger" role="alert" ref={errorSummary} tabIndex={-1}>
              <p>
                <strong>
                  Please fix {errorEntries.length === 1 ? "this" : "these"} to continue:
                </strong>
              </p>
              <ul>
                {errorEntries.map(({ key, message }) => (
                  <li key={key}>
                    <a
                      href={`#brief-${key}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(`brief-${key}`)?.focus();
                      }}
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <fieldset className="type-picker">
            <legend>What kind of event is it?</legend>
            <div className="type-options">
              {EVENT_TYPES.map((type) => {
                const Icon = EVENT_ICONS[type];
                return (
                  <label
                    key={type}
                    data-event={type}
                    className={form.eventType === type ? "type-option selected" : "type-option"}
                  >
                    <input
                      type="radio"
                      name="eventType"
                      value={type}
                      checked={form.eventType === type}
                      onChange={() => {
                        update("eventType", type);
                        update("priorities", []);
                      }}
                    />
                    <Icon aria-hidden="true" size={22} />
                    {EVENT_TEMPLATES[type].label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="form-grid">
            <Field id="brief-title" label="Event name" error={errors.title}>
              <input
                id="brief-title"
                type="text"
                maxLength={80}
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
                {...describedBy("brief-title", { error: errors.title })}
              />
            </Field>
            <Field id="brief-date" label="Date" error={errors.date}>
              <input
                id="brief-date"
                type="date"
                min={today}
                value={form.date}
                onChange={(event) => update("date", event.target.value)}
                {...describedBy("brief-date", { error: errors.date })}
              />
            </Field>
            <Field id="brief-guests" label="Number of guests" error={errors.guests}>
              <input
                id="brief-guests"
                type="number"
                inputMode="numeric"
                min={1}
                value={form.guests}
                onChange={(event) => update("guests", event.target.value)}
                {...describedBy("brief-guests", { error: errors.guests })}
              />
            </Field>
            <Field id="brief-budget" label="Total budget" error={errors.budget}>
              <input
                id="brief-budget"
                type="number"
                inputMode="numeric"
                min={1}
                value={form.budget}
                onChange={(event) => update("budget", event.target.value)}
                {...describedBy("brief-budget", { error: errors.budget })}
              />
            </Field>
            <Field id="brief-currency" label="Currency">
              <select
                id="brief-currency"
                value={form.currency}
                onChange={(event) => update("currency", event.target.value as Currency)}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </Field>
            <Field id="brief-city" label="City (optional)">
              <input
                id="brief-city"
                type="text"
                maxLength={80}
                value={form.city}
                onChange={(event) => update("city", event.target.value)}
              />
            </Field>
            <Field id="brief-vibe" label="Style or vibe (optional)">
              <input
                id="brief-vibe"
                type="text"
                maxLength={200}
                value={form.vibe}
                onChange={(event) => update("vibe", event.target.value)}
              />
            </Field>
            <Field
              id="brief-language"
              label="Language for AI suggestions"
              hint="Grace's menus stay in English."
            >
              <select
                id="brief-language"
                value={form.language}
                onChange={(event) => update("language", event.target.value as Language)}
                aria-describedby="brief-language-hint"
              >
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {LANGUAGE_NAMES[language]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            id="brief-notes"
            label="Anything Grace should know? (optional)"
            hint="Traditions, dietary or access needs, family dynamics, things to avoid."
          >
            <textarea
              id="brief-notes"
              rows={3}
              maxLength={600}
              value={form.notes}
              onChange={(event) => update("notes", event.target.value)}
              aria-describedby="brief-notes-hint"
            />
          </Field>

          <fieldset className="priority-picker">
            <legend>What matters most? Choose up to {MAX_PRIORITIES}.</legend>
            <p className="field-hint">These get a bigger share of the budget.</p>
            <div className="checkbox-grid">
              {categories.map(({ category, label }) => {
                const checked = form.priorities.includes(category);
                return (
                  <label key={category} className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && prioritiesFull}
                      onChange={() =>
                        update(
                          "priorities",
                          checked
                            ? form.priorities.filter((item) => item !== category)
                            : [...form.priorities, category],
                        )
                      }
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <button type="submit" className="button button-primary button-large">
            Create my plan
          </button>
        </form>
      </section>
    </div>
  );
}
