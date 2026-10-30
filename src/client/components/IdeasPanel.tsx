import { useState, type FormEvent } from "react";
import { Bookmark, BookmarkCheck, CalendarPlus, Sparkles } from "lucide-react";
import { formatMoney } from "../../shared/budget";
import { addDays } from "../../shared/dates";
import { textDirection } from "../../shared/languages";
import { clampDate } from "../../shared/timeline";
import type { Idea } from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Field, Loading, Why } from "./ui";

const STEERS = ["More budget-friendly", "More personal", "More eco-friendly", "Something bold"];

/** Ideas get three weeks of lead time by default, within the planning window. */
const IDEA_LEAD_DAYS = 21;

export default function IdeasPanel({ plan, today, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const [steer, setSteer] = useState("");
  const { state, run } = useAi("ideas");
  const { currency, language, date } = plan.brief;

  async function generate(steering: string): Promise<void> {
    const envelope = await run({
      brief: plan.brief,
      steer: steering,
      exclude: plan.ideas.map((idea) => idea.title).slice(-30),
    });
    if (envelope) {
      dispatch({ type: "setIdeas", ideas: envelope.data.ideas });
      announce(`${envelope.data.ideas.length} new ideas ready`);
    }
  }

  function addAsTask(idea: Idea): void {
    dispatch({
      type: "addTask",
      title: `Arrange: ${idea.title}`.slice(0, 160),
      due: clampDate(addDays(date, -IDEA_LEAD_DAYS), today, date),
      why: idea.why,
      source: "ai",
    });
    announce(`Added to your timeline: ${idea.title}`);
  }

  return (
    <div className="stack">
      <h2 className="sr-only">Ideas</h2>
      <section className="card card-ai" aria-labelledby="ideas-title">
        <h3 id="ideas-title">Ideas for {plan.brief.title}</h3>
        <form
          className="inline-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void generate(steer);
          }}
        >
          <Field id="idea-steer" label="Steer the ideas (optional)">
            <input
              id="idea-steer"
              type="text"
              maxLength={200}
              value={steer}
              onChange={(event) => setSteer(event.target.value)}
            />
          </Field>
          <button
            type="submit"
            className="button button-primary"
            disabled={state.status === "loading"}
          >
            <Sparkles aria-hidden="true" size={16} />
            {plan.ideas.length ? "Get new ideas" : "Get ideas"}
          </button>
        </form>
        <div className="chip-row" role="group" aria-label="Quick steering options">
          {STEERS.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              disabled={state.status === "loading"}
              onClick={() => {
                setSteer(option);
                void generate(option);
              }}
            >
              {option}
            </button>
          ))}
        </div>
        <div aria-live="polite">
          {state.status === "loading" ? (
            <Loading>Grace is thinking about your event…</Loading>
          ) : null}
          {state.status === "error" ? (
            <ErrorNote message={state.message} onRetry={() => void generate(steer)} />
          ) : null}
          {state.status === "success" ? (
            <>
              <AiBadge meta={state.envelope} />
              <Why text={state.envelope.data.reasoning} language={language} />
            </>
          ) : null}
        </div>
      </section>

      {plan.ideas.length > 0 ? (
        <ul className="idea-grid" aria-label="Ideas" data-testid="ideas">
          {plan.ideas.map((idea, index) => (
            <li
              key={idea.id}
              className="idea-card"
              data-tone={index % 4}
              lang={language}
              dir={textDirection(language)}
            >
              <p className="eyebrow">{idea.category}</p>
              <h4>{idea.title}</h4>
              <p>{idea.description}</p>
              <p className="idea-cost">Around {formatMoney(idea.estimatedCost, currency)}</p>
              <Why text={idea.why} language={language} />
              <div className="button-row">
                <button
                  type="button"
                  className="button"
                  aria-pressed={idea.saved}
                  onClick={() => {
                    dispatch({ type: "toggleIdeaSaved", id: idea.id });
                    announce(`${idea.saved ? "Unsaved" : "Saved"}: ${idea.title}`);
                  }}
                >
                  {idea.saved ? (
                    <BookmarkCheck aria-hidden="true" size={16} />
                  ) : (
                    <Bookmark aria-hidden="true" size={16} />
                  )}
                  {idea.saved ? "Saved" : "Save"}
                  <span className="sr-only">: {idea.title}</span>
                </button>
                <button type="button" className="button" onClick={() => addAsTask(idea)}>
                  <CalendarPlus aria-hidden="true" size={16} />
                  Add to timeline
                  <span className="sr-only">: {idea.title}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
