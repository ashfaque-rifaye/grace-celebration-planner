import { useState } from "react";
import { Download, PiggyBank, Receipt, Scale, Sparkles, Users, Wallet } from "lucide-react";
import { formatMoney, summarizeBudget } from "../../shared/budget";
import { budgetToCsv } from "../../shared/exports";
import { buildPlanContext } from "../../shared/plan-context";
import { useAnnounce } from "../lib/announcer";
import { downloadText, slugify } from "../lib/download";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Field, Loading, ProgressBar, Stat, Why } from "./ui";

/** A money input that commits on blur, so typing does not reshuffle the table. */
function MoneyInput({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (amount: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      className="money-input"
      type="number"
      inputMode="numeric"
      min={0}
      aria-label={label}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null) {
          const amount = Number(draft);
          if (draft.trim() !== "" && Number.isFinite(amount) && amount >= 0) onCommit(amount);
          setDraft(null);
        }
      }}
    />
  );
}

export default function BudgetPanel({ plan, today, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const { state, run } = useAi("budget");
  const summary = summarizeBudget(plan);
  const { currency, language } = plan.brief;
  const money = (amount: number) => formatMoney(amount, currency);
  const review = plan.budgetReview;
  // Bars scale to the largest line so small lines stay visible; labels give the share.
  const largestLine = Math.max(1, ...summary.lines.map((line) => line.allocated));

  async function askForReview(): Promise<void> {
    const envelope = await run({ context: buildPlanContext(plan, today) });
    if (envelope) {
      dispatch({ type: "setBudgetReview", review: { ...envelope.data, source: envelope.source } });
      announce("Budget review ready");
    }
  }

  const labelFor = (id: string) => plan.budgetLines.find((line) => line.id === id)?.label ?? id;

  return (
    <div className="stack">
      <h2 className="sr-only">Budget</h2>

      <section className="card" aria-labelledby="budget-summary-title">
        <div className="card-heading">
          <h3 id="budget-summary-title">Where the money stands</h3>
          <button
            type="button"
            className="button"
            onClick={() => {
              downloadText(
                `${slugify(plan.brief.title)}-budget.csv`,
                budgetToCsv(plan),
                "text/csv",
              );
              announce("Budget CSV downloaded");
            }}
          >
            <Download aria-hidden="true" size={16} />
            Export CSV
          </button>
        </div>
        <dl className="stat-grid">
          <Stat icon={Wallet} label="Total budget" value={money(summary.total)} />
          <Stat
            icon={Receipt}
            label="Committed"
            value={money(summary.committed)}
            detail={`${summary.usedPercent}% used`}
          />
          <Stat
            icon={PiggyBank}
            label={summary.remaining < 0 ? "Over by" : "Remaining"}
            value={money(Math.abs(summary.remaining))}
          />
          <Stat
            icon={Users}
            label="Per guest"
            value={money(summary.perGuest)}
            detail={`${plan.brief.guests} guests`}
          />
        </dl>
        <ProgressBar
          value={summary.usedPercent}
          label="Budget committed"
          tone={summary.over ? "danger" : "default"}
        />
        <Field
          id="total-budget"
          label={`Change total budget (${currency})`}
          hint="Every line rescales in proportion."
        >
          <MoneyInput
            id="total-budget"
            label={`Change total budget (${currency})`}
            value={summary.total}
            onCommit={(amount) => {
              dispatch({ type: "setTotalBudget", amount });
              announce(`Total budget is now ${money(amount)}`);
            }}
          />
        </Field>
      </section>

      {summary.unallocated !== 0 ? (
        <div className="callout callout-warn" role="status">
          <p>
            {summary.unallocated > 0
              ? `${money(summary.unallocated)} is not assigned to any line.`
              : `Your lines add up to ${money(-summary.unallocated)} more than your total.`}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              dispatch({ type: "rebalanceBudget" });
              announce("Budget rebalanced to match your total");
            }}
          >
            <Scale aria-hidden="true" size={16} />
            Rebalance to {money(summary.total)}
          </button>
        </div>
      ) : null}

      <section className="card" aria-labelledby="budget-split-title">
        <div className="card-heading">
          <h3 id="budget-split-title">How the budget is split</h3>
          <ul className="legend" aria-hidden="true">
            <li>
              <span className="swatch swatch-allocated" /> Allocated
            </li>
            <li>
              <span className="swatch swatch-committed" /> Committed
            </li>
          </ul>
        </div>
        <ul className="budget-bars">
          {[...summary.lines]
            .sort((a, b) => b.allocated - a.allocated)
            .map((line) => (
              <li key={line.id}>
                <span className="budget-bar-label">{line.label}</span>
                <span className="budget-bar-value">
                  {money(line.allocated)}
                  {summary.total > 0 ? (
                    <small>{Math.round((line.allocated / summary.total) * 100)}%</small>
                  ) : null}
                </span>
                <span className="budget-bar-track" aria-hidden="true">
                  <span
                    className="budget-bar-allocated"
                    style={{ width: `${(line.allocated / largestLine) * 100}%` }}
                  >
                    <span
                      className={line.over ? "budget-bar-committed over" : "budget-bar-committed"}
                      style={{ width: `${Math.min(100, line.usedPercent)}%` }}
                    />
                  </span>
                </span>
              </li>
            ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="budget-lines-title">
        <h3 id="budget-lines-title">Budget lines</h3>
        <div
          className="table-scroll"
          tabIndex={0}
          role="group"
          aria-labelledby="budget-lines-title"
        >
          <table>
            <caption className="sr-only">
              Allocated, spent, committed and remaining amounts for each budget line, in {currency}
            </caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Allocated</th>
                <th scope="col">Spent by hand</th>
                <th scope="col">Committed</th>
                <th scope="col">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {summary.lines.map((line) => (
                <tr key={line.id} className={line.over ? "row-over" : undefined}>
                  <th scope="row">{line.label}</th>
                  <td>
                    <MoneyInput
                      id={`allocated-${line.id}`}
                      label={`Allocated to ${line.label}`}
                      value={line.allocated}
                      onCommit={(amount) =>
                        dispatch({ type: "setLineAllocated", id: line.id, amount })
                      }
                    />
                  </td>
                  <td>
                    <MoneyInput
                      id={`spent-${line.id}`}
                      label={`Spent by hand on ${line.label}`}
                      value={line.spent}
                      onCommit={(amount) => dispatch({ type: "setLineSpent", id: line.id, amount })}
                    />
                  </td>
                  <td>{money(line.committed)}</td>
                  <td>
                    {money(line.remaining)}
                    {line.over ? <span className="tag tag-danger">Over</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">Booked vendors&apos; quotes count towards Committed automatically.</p>
      </section>

      <section className="card card-ai" aria-labelledby="budget-ai-title">
        <div className="card-heading">
          <h3 id="budget-ai-title">Ask Grace to review this budget</h3>
          <button
            type="button"
            className="button button-primary"
            disabled={state.status === "loading"}
            onClick={() => void askForReview()}
          >
            <Sparkles aria-hidden="true" size={16} />
            {review ? "Review again" : "Review my budget"}
          </button>
        </div>
        <div aria-live="polite">
          {state.status === "loading" ? <Loading>Grace is reviewing your numbers…</Loading> : null}
          {state.status === "error" ? (
            <ErrorNote message={state.message} onRetry={() => void askForReview()} />
          ) : null}
          {review ? (
            <div data-testid="budget-review">
              <AiBadge
                meta={state.status === "success" ? state.envelope : { source: review.source }}
              />
              <Why text={review.reasoning} language={language} />
              <ul className="advice-list">
                {review.advice.map((item) => (
                  <li key={item.title} lang={language}>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </li>
                ))}
              </ul>
              {review.moves.length > 0 ? (
                <>
                  <h4>Suggested moves</h4>
                  <ul className="advice-list">
                    {review.moves.map((move) => (
                      <li key={`${move.from}-${move.to}-${move.amount}`}>
                        <p>
                          <strong>
                            Move {money(move.amount)} from {labelFor(move.from)} to{" "}
                            {labelFor(move.to)}
                          </strong>
                        </p>
                        <Why text={move.why} language={language} />
                        <button
                          type="button"
                          className="button"
                          onClick={() => {
                            dispatch({
                              type: "moveBudget",
                              from: move.from,
                              to: move.to,
                              amount: move.amount,
                            });
                            dispatch({
                              type: "setBudgetReview",
                              review: {
                                ...review,
                                moves: review.moves.filter((candidate) => candidate !== move),
                              },
                            });
                            announce(`Moved ${money(move.amount)} to ${labelFor(move.to)}`);
                          }}
                        >
                          Apply this move
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
