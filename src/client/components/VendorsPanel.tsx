import { useState, type FormEvent } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { formatDate } from "../../shared/dates";
import { formatMoney } from "../../shared/budget";
import { isVendorSecured } from "../../shared/insights";
import { VENDOR_STATUSES, type Vendor, type VendorStatus } from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Field, Loading, ProgressBar, Why } from "./ui";

const STATUS_LABEL: Record<VendorStatus, string> = {
  "to-contact": "To contact",
  quoted: "Quote received",
  booked: "Booked",
  paid: "Paid",
};

function VendorCard({
  vendor,
  defaultOpen,
  plan,
  today,
  dispatch,
}: PanelProps & { vendor: Vendor; defaultOpen: boolean }) {
  // Only the initial state: after that the card stays as the user left it, even
  // when booking this vendor makes a different one the next to act on.
  const [initiallyOpen] = useState(defaultOpen);
  const announce = useAnnounce();
  const { state, run } = useAi("vendor");
  const { currency, language } = plan.brief;
  const secured = isVendorSecured(vendor);
  const late = !secured && vendor.bookBy < today;
  const allocated =
    plan.budgetLines.find((line) => line.category === vendor.category)?.allocated ?? null;
  const update = (patch: Parameters<PanelProps["dispatch"]>[0] & { type: "updateVendor" }) =>
    dispatch(patch);
  const stepIndex = VENDOR_STATUSES.indexOf(vendor.status);
  const checksDone = vendor.checks.filter((check) => check.done).length;

  async function prepare(): Promise<void> {
    const envelope = await run({ brief: plan.brief, vendorLabel: vendor.label, allocated });
    if (envelope) {
      dispatch({ type: "setVendorBrief", id: vendor.id, brief: envelope.data });
      announce(`Questions ready for ${vendor.label}`);
    }
  }

  return (
    <li className="vendor-card">
      <details open={initiallyOpen}>
        <summary className="vendor-summary">
          <h4 lang={vendor.source === "ai" ? language : undefined}>{vendor.label}</h4>
          {vendor.source === "ai" ? (
            <span className="tag tag-ai">
              <Sparkles aria-hidden="true" size={12} /> Suggested for this event
            </span>
          ) : null}
          <span className={late ? "tag tag-danger" : "tag"}>
            {late ? "Late: book by " : "Book by "}
            {formatDate(vendor.bookBy)}
          </span>
          <span className={secured ? "tag tag-ok" : "tag"}>{STATUS_LABEL[vendor.status]}</span>
          <span className="tag">
            {checksDone}/{vendor.checks.length} checks
          </span>
        </summary>
        {vendor.why ? <Why text={vendor.why} language={language} /> : null}

        <ol className="stepper" aria-hidden="true">
          {VENDOR_STATUSES.map((status, index) => (
            <li key={status} className={index <= stepIndex ? "step step-reached" : "step"}>
              {STATUS_LABEL[status]}
            </li>
          ))}
        </ol>

        <div className="vendor-grid">
          <div className="vendor-fields">
            <Field id={`status-${vendor.id}`} label="Status">
              <select
                id={`status-${vendor.id}`}
                value={vendor.status}
                onChange={(event) => {
                  const status = event.target.value as VendorStatus;
                  update({ type: "updateVendor", id: vendor.id, patch: { status } });
                  announce(`${vendor.label}: ${STATUS_LABEL[status]}`);
                }}
              >
                {VENDOR_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id={`quote-${vendor.id}`}
              label={`Quote (${currency})`}
              {...(allocated !== null
                ? { hint: `${formatMoney(allocated, currency)} set aside` }
                : {})}
            >
              <input
                id={`quote-${vendor.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                value={vendor.quote ?? ""}
                {...(allocated !== null ? { "aria-describedby": `quote-${vendor.id}-hint` } : {})}
                onChange={(event) => {
                  const value = event.target.value;
                  const amount = Number(value);
                  update({
                    type: "updateVendor",
                    id: vendor.id,
                    patch: { quote: value === "" || !(amount >= 0) ? null : amount },
                  });
                }}
              />
            </Field>
            <Field
              id={`contact-${vendor.id}`}
              label="Contact"
              hint="Stays in this browser, and is never sent to the AI."
            >
              <input
                id={`contact-${vendor.id}`}
                type="text"
                maxLength={120}
                autoComplete="off"
                value={vendor.contact}
                aria-describedby={`contact-${vendor.id}-hint`}
                onChange={(event) =>
                  update({
                    type: "updateVendor",
                    id: vendor.id,
                    patch: { contact: event.target.value },
                  })
                }
              />
            </Field>
          </div>

          <fieldset className="vendor-checks">
            <legend>
              Checklist: {checksDone} of {vendor.checks.length} done
            </legend>
            {vendor.checks.map((check) => (
              <label key={check.id} className={check.done ? "check check-done" : "check"}>
                <input
                  type="checkbox"
                  checked={check.done}
                  onChange={() => {
                    dispatch({ type: "toggleVendorCheck", vendorId: vendor.id, checkId: check.id });
                    announce(
                      `${vendor.label}: ${check.done ? "Reopened" : "Done"}: ${check.label}`,
                    );
                  }}
                />
                <span>{check.label}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="vendor-actions">
          <button
            type="button"
            className="button"
            disabled={state.status === "loading"}
            onClick={() => void prepare()}
          >
            <Sparkles aria-hidden="true" size={16} />
            {vendor.brief ? "Refresh questions" : "What should I ask them?"}
          </button>
          {vendor.source !== "template" ? (
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove vendor: ${vendor.label}`}
              onClick={() => {
                dispatch({ type: "removeVendor", id: vendor.id });
                announce(`Removed vendor: ${vendor.label}`);
              }}
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>

        <div aria-live="polite">
          {state.status === "loading" ? (
            <Loading>Grace is preparing your questions…</Loading>
          ) : null}
          {state.status === "error" ? (
            <ErrorNote message={state.message} onRetry={() => void prepare()} />
          ) : null}
          {state.status === "success" ? <AiBadge meta={state.envelope} /> : null}
          {vendor.brief ? (
            <div className="vendor-brief" lang={language} data-testid="vendor-brief">
              <Why text={vendor.brief.reasoning} language={language} />
              <h5>Questions to ask</h5>
              <ul>
                {vendor.brief.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
              {vendor.brief.redFlags.length > 0 ? (
                <>
                  <h5>Red flags</h5>
                  <ul>
                    {vendor.brief.redFlags.map((flag) => (
                      <li key={flag}>{flag}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <h5>Negotiation tip</h5>
              <p>{vendor.brief.negotiationTip}</p>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export default function VendorsPanel(props: PanelProps) {
  const { plan, dispatch } = props;
  const announce = useAnnounce();
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState("");
  const secured = plan.vendors.filter(isVendorSecured).length;
  const sorted = [...plan.vendors].sort((a, b) => a.bookBy.localeCompare(b.bookBy));
  const nextToBook = sorted.find((vendor) => !isVendorSecured(vendor));
  const allChecks = plan.vendors.flatMap((vendor) => vendor.checks);
  const checksDone = allChecks.filter((check) => check.done).length;
  const checksTotal = allChecks.length;

  function addVendor(event: FormEvent): void {
    event.preventDefault();
    if (!label.trim()) {
      setLabelError("Enter the kind of vendor you need");
      return;
    }
    setLabelError("");
    dispatch({ type: "addVendor", label });
    announce(`Added vendor: ${label.trim()}`);
    setLabel("");
  }

  return (
    <div className="stack">
      <h2 className="sr-only">Vendors</h2>
      <section className="card" aria-labelledby="vendor-progress-title">
        <h3 id="vendor-progress-title">
          {secured} of {plan.vendors.length} vendors booked
        </h3>
        <p className="muted">
          Earliest booking date first. {checksDone} of {checksTotal} checklist items done across all
          vendors.
        </p>
        <ProgressBar
          value={plan.vendors.length ? (secured / plan.vendors.length) * 100 : 0}
          label="Vendors booked"
        />
        <form className="inline-form" noValidate onSubmit={addVendor}>
          <Field id="new-vendor" label="Add a vendor" error={labelError}>
            <input
              id="new-vendor"
              type="text"
              maxLength={80}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              {...(labelError
                ? { "aria-invalid": true as const, "aria-describedby": "new-vendor-error" }
                : {})}
            />
          </Field>
          <button type="submit" className="button button-primary">
            <Plus aria-hidden="true" size={16} />
            Add vendor
          </button>
        </form>
      </section>
      <ul className="vendor-list" aria-label="Vendor checklist, earliest booking date first">
        {sorted.map((vendor) => (
          <VendorCard
            key={vendor.id}
            vendor={vendor}
            defaultOpen={vendor.id === nextToBook?.id}
            {...props}
          />
        ))}
      </ul>
    </div>
  );
}
