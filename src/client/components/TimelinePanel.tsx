import { useMemo, useState, type FormEvent } from "react";
import { CalendarPlus, ListChecks, Plus, Sparkles, Trash2 } from "lucide-react";
import { formatDate } from "../../shared/dates";
import { planToIcs } from "../../shared/exports";
import { groupTasksByPhase, isOverdue } from "../../shared/timeline";
import { useAnnounce } from "../lib/announcer";
import { downloadText, slugify } from "../lib/download";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Field, Loading, ProgressBar, Why } from "./ui";

type Filter = "all" | "open" | "overdue";

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
];

export default function TimelinePanel({ plan, today, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const [filter, setFilter] = useState<Filter>("all");
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState(today);
  const [titleError, setTitleError] = useState("");
  const [startTime, setStartTime] = useState("17:00");
  const { state, run } = useAi("runsheet");
  const { language } = plan.brief;

  const visible = useMemo(() => {
    const tasks = plan.tasks.filter((task) => {
      if (filter === "open") return !task.done;
      if (filter === "overdue") return isOverdue(task, today);
      return true;
    });
    return groupTasksByPhase(tasks, plan.brief.date);
  }, [plan.tasks, plan.brief.date, filter, today]);

  const done = plan.tasks.filter((task) => task.done).length;

  function addTask(event: FormEvent): void {
    event.preventDefault();
    if (!newTitle.trim()) {
      setTitleError("Enter what needs doing");
      return;
    }
    setTitleError("");
    dispatch({ type: "addTask", title: newTitle, due: newDue });
    announce(`Added task: ${newTitle.trim()}`);
    setNewTitle("");
  }

  async function buildRunSheet(): Promise<void> {
    const envelope = await run({ brief: plan.brief, startTime });
    if (envelope) {
      dispatch({ type: "setRunSheet", items: envelope.data.items });
      announce("Run sheet ready");
    }
  }

  return (
    <div className="stack">
      <h2 className="sr-only">Timeline</h2>

      <section className="card" aria-labelledby="timeline-title">
        <div className="card-heading">
          <h3 id="timeline-title">
            {done} of {plan.tasks.length} tasks done
          </h3>
          <button
            type="button"
            className="button"
            onClick={() => {
              downloadText(
                `${slugify(plan.brief.title)}.ics`,
                planToIcs(plan, new Date().toISOString()),
                "text/calendar",
              );
              announce("Calendar file downloaded");
            }}
          >
            <CalendarPlus aria-hidden="true" size={16} />
            Add to calendar
          </button>
        </div>
        <ProgressBar
          value={plan.tasks.length ? (done / plan.tasks.length) * 100 : 0}
          label="Tasks completed"
        />

        <div className="chip-row" role="group" aria-label="Filter tasks">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? <p className="muted">No tasks match this filter.</p> : null}
        {visible.map((group) => (
          <section key={group.id} className="phase" aria-labelledby={`phase-${group.id}`}>
            <h4 id={`phase-${group.id}`}>{group.label}</h4>
            <ul className="task-list">
              {group.tasks.map((task) => {
                const overdue = isOverdue(task, today);
                return (
                  <li key={task.id} className={task.done ? "task task-done" : "task"}>
                    <label className="checkbox-option">
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={() => {
                          dispatch({ type: "toggleTask", id: task.id });
                          announce(`${task.done ? "Reopened" : "Done"}: ${task.title}`);
                        }}
                      />
                      <span lang={task.source === "ai" ? language : undefined}>{task.title}</span>
                    </label>
                    <span className={overdue ? "tag tag-danger" : "tag"}>
                      {overdue ? "Overdue: " : ""}
                      {formatDate(task.due)}
                    </span>
                    {task.source === "ai" ? (
                      <span className="tag tag-ai">
                        <Sparkles aria-hidden="true" size={12} /> Tailored
                      </span>
                    ) : null}
                    {task.source !== "template" ? (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove task: ${task.title}`}
                        onClick={() => {
                          dispatch({ type: "removeTask", id: task.id });
                          announce(`Removed task: ${task.title}`);
                        }}
                      >
                        <Trash2 aria-hidden="true" size={16} />
                      </button>
                    ) : null}
                    {task.why ? <Why text={task.why} language={language} /> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </section>

      <section className="card" aria-labelledby="add-task-title">
        <h3 id="add-task-title">Add a task</h3>
        <form className="inline-form" noValidate onSubmit={addTask}>
          <Field id="new-task-title" label="What needs doing?" error={titleError}>
            <input
              id="new-task-title"
              type="text"
              maxLength={160}
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              {...(titleError
                ? { "aria-invalid": true as const, "aria-describedby": "new-task-title-error" }
                : {})}
            />
          </Field>
          <Field id="new-task-due" label="Due date">
            <input
              id="new-task-due"
              type="date"
              min={today}
              max={plan.brief.date}
              value={newDue}
              onChange={(event) => setNewDue(event.target.value)}
            />
          </Field>
          <button type="submit" className="button button-primary">
            <Plus aria-hidden="true" size={16} />
            Add task
          </button>
        </form>
      </section>

      <section className="card card-ai" aria-labelledby="runsheet-title">
        <h3 id="runsheet-title">
          <ListChecks aria-hidden="true" size={18} /> Run sheet for the day
        </h3>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void buildRunSheet();
          }}
        >
          <Field id="start-time" label="Main event starts at">
            <input
              id="start-time"
              type="time"
              required
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </Field>
          <button
            type="submit"
            className="button button-primary"
            disabled={state.status === "loading" || !startTime}
          >
            <Sparkles aria-hidden="true" size={16} />
            {plan.runSheet.length ? "Rewrite run sheet" : "Write my run sheet"}
          </button>
        </form>
        <div aria-live="polite">
          {state.status === "loading" ? <Loading>Grace is planning the day…</Loading> : null}
          {state.status === "error" ? (
            <ErrorNote message={state.message} onRetry={() => void buildRunSheet()} />
          ) : null}
          {state.status === "success" ? (
            <>
              <AiBadge meta={state.envelope} />
              <Why text={state.envelope.data.reasoning} language={language} />
            </>
          ) : null}
        </div>
        {plan.runSheet.length > 0 ? (
          <ol className="run-sheet" lang={language} data-testid="run-sheet">
            {plan.runSheet.map((item) => (
              <li key={`${item.time}-${item.title}`}>
                <time dateTime={item.time}>{item.time}</time>
                <span>{item.title}</span>
                <span className="muted">{item.owner}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}
