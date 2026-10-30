/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, todayIso } from "../shared/dates";
import { planToJson } from "../shared/exports";
import { createPlan } from "../shared/plan";
import { makeBrief } from "../test/fixtures";
import { a11yViolations, memoryStorage, mockAi } from "../test/ui";
import { App } from "./App";
import { validateForm } from "./components/IntakeFlow";
import { createPlanStore, type PlanStore } from "./lib/plan-store";
import { navigate, planHref } from "./lib/route";

const today = todayIso();
const future = addDays(today, 200);

const personalizeReply = {
  summary: "Tailored for Chennai",
  tasks: [{ title: "Book nadaswaram players", daysBefore: 60, why: "A Tamil custom" }],
  vendors: [{ label: "Priest", category: null, daysBefore: 30, why: "For the ceremony" }],
  reasoning: "Your notes mention tradition",
};

function seededStore(): PlanStore {
  const store = createPlanStore(memoryStorage());
  store.add(
    createPlan(makeBrief({ date: future }), {
      id: "plan-1",
      today,
      now: new Date().toISOString(),
    }),
  );
  return store;
}

beforeEach(() => {
  window.location.hash = "";
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

async function goTo(href: string): Promise<void> {
  await act(async () => {
    navigate(href);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await Promise.resolve();
  });
}

describe("home", () => {
  it("has a skip link, landmarks, a single h1, and no accessibility violations", async () => {
    const { container } = render(<App store={createPlanStore(memoryStorage())} />);
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main",
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(await a11yViolations(container)).toEqual([]);
  });

  it("moves focus to main from the skip link", async () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    await userEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("fills the form from a description, showing the source and what it assumed", async () => {
    mockAi({
      brief: {
        brief: {
          title: "Priya's 30th",
          eventType: "birthday",
          date: future,
          guests: 40,
          budget: 80000,
          currency: "INR",
          city: "Pune",
          vibe: "jazz",
          notes: "Vegan",
          priorities: ["cake"],
        },
        assumptions: ["Assumed rupees"],
        questions: ["What time does it start?"],
        reasoning: "You described a birthday",
      },
    });
    render(<App store={createPlanStore(memoryStorage())} />);
    await userEvent.type(screen.getByLabelText("What are you planning?"), "Priya turns 30");
    await userEvent.click(screen.getByRole("button", { name: /Fill in the details/ }));

    const result = await screen.findByTestId("brief-result");
    expect(within(result).getByTestId("ai-source")).toHaveTextContent("AI · Gemini");
    expect(within(result).getByText("Assumed rupees")).toBeInTheDocument();
    expect(within(result).getByText("What time does it start?")).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("Priya's 30th");
    expect(screen.getByLabelText("Number of guests")).toHaveValue(40);
    expect(screen.getByLabelText("Total budget")).toHaveValue(80000);
    expect(screen.getByLabelText("City (optional)")).toHaveValue("Pune");
    expect(screen.getByRole("radio", { name: "Birthday" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Cake" })).toBeChecked();
    expect(screen.getByRole("heading", { name: "Event details" })).toHaveFocus();
  });

  it("a partial draft leaves the rest of the form alone", async () => {
    mockAi({ brief: { brief: {}, assumptions: [], questions: [], reasoning: "Little to go on" } });
    render(<App store={createPlanStore(memoryStorage())} />);
    await userEvent.type(screen.getByLabelText("Event name"), "Keep me");
    await userEvent.type(screen.getByLabelText("What are you planning?"), "something");
    await userEvent.click(screen.getByRole("button", { name: /Fill in the details/ }));
    await screen.findByTestId("brief-result");
    expect(screen.getByLabelText("Event name")).toHaveValue("Keep me");
  });

  it("fills in an example description on request", async () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    await userEvent.click(screen.getByRole("button", { name: "Try: A birthday" }));
    const description = screen.getByLabelText<HTMLTextAreaElement>("What are you planning?");
    expect(description.value).toContain("40th birthday");
  });

  it("does not call the AI for an empty description", async () => {
    const fetchMock = mockAi({});
    render(<App store={createPlanStore(memoryStorage())} />);
    expect(screen.getByRole("button", { name: /Fill in the details/ })).toBeDisabled();
    const form = screen.getByLabelText("What are you planning?").closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a failed description request without losing what was typed", async () => {
    mockAi({});
    render(<App store={createPlanStore(memoryStorage())} />);
    await userEvent.type(screen.getByLabelText("What are you planning?"), "A party");
    await userEvent.click(screen.getByRole("button", { name: /Fill in the details/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ran into a problem");
    expect(screen.getByLabelText("What are you planning?")).toHaveValue("A party");
  });

  it("shows an error summary that links to each invalid field", async () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    await userEvent.click(screen.getByRole("button", { name: "Create my plan" }));

    const summary = screen.getByRole("alert");
    expect(summary).toHaveFocus();
    expect(
      within(summary).getByRole("link", { name: "Give your event a name" }),
    ).toBeInTheDocument();
    expect(
      within(summary).getByRole("link", { name: "Choose the date of your event" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Event name")).toHaveAccessibleDescription(
      "Give your event a name",
    );

    await userEvent.click(within(summary).getByRole("link", { name: "Give your event a name" }));
    expect(screen.getByLabelText("Event name")).toHaveFocus();

    await userEvent.type(screen.getByLabelText("Event name"), "Party");
    expect(screen.getByLabelText("Event name")).not.toHaveAttribute("aria-invalid");
  });

  it("creates a plan from the form and opens it, with AI tailoring on top", async () => {
    mockAi({ personalize: personalizeReply });
    const store = createPlanStore(memoryStorage());
    render(<App store={store} />);
    await userEvent.type(screen.getByLabelText("Event name"), "Asha's Wedding");
    await userEvent.type(screen.getByLabelText("Date"), future);
    await userEvent.type(screen.getByLabelText("Number of guests"), "200");
    await userEvent.type(screen.getByLabelText("Total budget"), "1500000");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "USD");
    await userEvent.type(screen.getByLabelText("City (optional)"), "Chennai");
    await userEvent.type(screen.getByLabelText("Style or vibe (optional)"), "garden");
    await userEvent.type(screen.getByLabelText(/Anything Grace should know/), "Vegetarian");
    await userEvent.selectOptions(screen.getByLabelText("Language for AI suggestions"), "ta");
    await userEvent.click(screen.getByRole("checkbox", { name: "Food & drink" }));
    await userEvent.click(screen.getByRole("button", { name: "Create my plan" }));
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await Promise.resolve();
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Asha's Wedding" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Tailored for Chennai")).toBeInTheDocument();
    const [plan] = store.getPlans();
    expect(plan?.brief).toMatchObject({
      language: "ta",
      currency: "USD",
      priorities: ["catering"],
    });
    expect(plan?.tasks.some((task) => task.title === "Book nadaswaram players")).toBe(true);
    expect(plan?.vendors.some((vendor) => vendor.label === "Priest")).toBe(true);
    await waitFor(() => expect(document.title).toBe("Asha's Wedding | Grace"));
  });

  it("limits priorities to three and resets them when the event type changes", async () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Venue" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Food & drink" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Invitations" }));
    expect(screen.getByRole("checkbox", { name: "Attire & styling" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Venue" }));
    expect(screen.getByRole("checkbox", { name: "Attire & styling" })).toBeEnabled();
    await userEvent.click(screen.getByRole("radio", { name: "Community event" }));
    expect(screen.getByRole("checkbox", { name: "Food & refreshments" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Permits & insurance" })).toBeEnabled();
  });
});

describe("validateForm", () => {
  const valid = {
    title: "Party",
    eventType: "birthday" as const,
    date: future,
    guests: "10",
    budget: "1000",
    currency: "INR" as const,
    city: "",
    vibe: "",
    notes: "",
    priorities: [],
    language: "en" as const,
  };

  it("accepts a valid form", () => {
    expect(validateForm(valid, today).brief?.guests).toBe(10);
  });

  it.each([
    ["title", { title: "  " }, "name"],
    ["guests", { guests: "" }, "number of guests"],
    ["guests", { guests: "0" }, "at least 1"],
    ["guests", { guests: "2.5" }, "whole number"],
    ["guests", { guests: "9999999" }, "cannot exceed"],
    ["budget", { budget: "" }, "total budget"],
    ["budget", { budget: "-5" }, "more than zero"],
    ["budget", { budget: "9e15" }, "too large"],
    ["date", { date: "" }, "date of your event"],
    ["date", { date: addDays(today, -1) }, "has not passed"],
  ])("rejects a bad %s: %j", (field, patch, message) => {
    const { errors } = validateForm({ ...valid, ...patch }, today);
    expect(errors?.[field as keyof typeof errors]).toContain(message);
  });

  it("accepts an event today", () => {
    expect(validateForm({ ...valid, date: today }, today).brief).toBeDefined();
  });
});

describe("saved plans", () => {
  it("lists plans and opens one", async () => {
    render(<App store={seededStore()} />);
    expect(screen.getByRole("link", { name: "Asha & Ravi's Wedding" })).toHaveAttribute(
      "href",
      planHref("plan-1"),
    );
    expect(screen.getByText(/200 guests/)).toBeInTheDocument();
  });

  it("asks before deleting, and can be cancelled", async () => {
    const store = seededStore();
    render(<App store={store} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Asha & Ravi's Wedding" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(store.getPlans()).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Delete Asha & Ravi's Wedding" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Asha & Ravi's Wedding" }));
    expect(store.getPlans()).toHaveLength(0);
    expect(screen.getByTestId("announcer")).toHaveTextContent("Deleted");
  });

  it("imports a valid backup and opens it", async () => {
    const store = createPlanStore(memoryStorage());
    render(<App store={store} />);
    const plan = createPlan(makeBrief({ date: future, title: "From backup" }), {
      id: "plan-9",
      today,
      now: new Date().toISOString(),
    });
    const file = new File([planToJson(plan)], "backup.json", { type: "application/json" });
    await userEvent.upload(screen.getByLabelText("Import a Grace plan backup"), file);
    await waitFor(() => expect(store.getPlan("plan-9")).toBeDefined());
    expect(window.location.hash).toBe(planHref("plan-9"));
  });

  it("rejects a bad backup with a clear message", async () => {
    const store = createPlanStore(memoryStorage());
    render(<App store={store} />);
    const file = new File(['{"not":"a plan"}'], "backup.json", { type: "application/json" });
    await userEvent.upload(screen.getByLabelText("Import a Grace plan backup"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("not a valid Grace plan");
    expect(store.getPlans()).toHaveLength(0);
  });

  it("rejects an oversized backup without reading it", async () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    const file = new File(["x"], "backup.json", { type: "application/json" });
    Object.defineProperty(file, "size", { value: 5_000_000 });
    await userEvent.upload(screen.getByLabelText("Import a Grace plan backup"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("too large");
  });

  it("opens the file picker from its visible button", async () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    const input = screen.getByLabelText("Import a Grace plan backup");
    const click = vi.spyOn(input, "click");
    await userEvent.click(screen.getByRole("button", { name: "Import backup" }));
    expect(click).toHaveBeenCalled();
  });
});

describe("plan workspace", () => {
  beforeEach(() => {
    mockAi({ personalize: personalizeReply });
  });

  it("explains a plan that is not in this browser", async () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    await goTo("#/plans/missing/overview");
    expect(
      screen.getByRole("heading", { name: "We could not find that plan" }),
    ).toBeInTheDocument();
  });

  it("uses the tabs pattern, moving between panels by click and keyboard", async () => {
    render(<App store={seededStore()} />);
    await goTo(planHref("plan-1"));
    const tablist = await screen.findByRole("tablist", { name: "Plan sections" });
    const overview = within(tablist).getByRole("tab", { name: "Overview" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(overview).toHaveAttribute("tabindex", "0");
    expect(within(tablist).getByRole("tab", { name: "Budget" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeInTheDocument();

    await userEvent.click(within(tablist).getByRole("tab", { name: "Budget" }));
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await Promise.resolve();
    });
    expect(
      await screen.findByRole("heading", { name: "Where the money stands" }),
    ).toBeInTheDocument();

    const budgetTab = within(tablist).getByRole("tab", { name: "Budget" });
    budgetTab.focus();
    const press = async (key: string) => {
      fireEvent.keyDown(document.activeElement as Element, { key });
      await act(async () => {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        await Promise.resolve();
      });
    };
    await press("ArrowRight");
    expect(within(tablist).getByRole("tab", { name: "Timeline" })).toHaveFocus();
    expect(window.location.hash).toContain("/timeline");
    await press("ArrowLeft");
    expect(within(tablist).getByRole("tab", { name: "Budget" })).toHaveFocus();
    await press("Home");
    expect(within(tablist).getByRole("tab", { name: "Overview" })).toHaveFocus();
    await press("ArrowLeft");
    expect(within(tablist).getByRole("tab", { name: "Ask Grace" })).toHaveFocus();
    await press("ArrowRight");
    expect(within(tablist).getByRole("tab", { name: "Overview" })).toHaveFocus();
    await press("End");
    expect(within(tablist).getByRole("tab", { name: "Ask Grace" })).toHaveFocus();
    const before = window.location.hash;
    await press("x");
    expect(window.location.hash).toBe(before);
  });

  it("renders each lazy panel and passes an accessibility scan", async () => {
    const { container } = render(<App store={seededStore()} />);
    const panels: [string, RegExp][] = [
      ["timeline", /tasks done/],
      ["vendors", /vendors booked/],
      ["ideas", /Ideas for/],
      ["assistant", /Ask Grace about this plan/],
    ];
    for (const [tab, heading] of panels) {
      await goTo(`#/plans/plan-1/${tab}`);
      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
      expect(await a11yViolations(container)).toEqual([]);
    }
  });

  it("moves focus to main on navigating between screens", async () => {
    render(<App store={seededStore()} />);
    await goTo(planHref("plan-1"));
    await screen.findByRole("tablist");
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("tailors a plan once and not again after it is done", async () => {
    const fetchMock = mockAi({ personalize: personalizeReply });
    const store = seededStore();
    const { unmount } = render(<App store={store} />);
    await goTo(planHref("plan-1"));
    await screen.findByText("Tailored for Chennai");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(store.getPlan("plan-1")?.personalization?.source).toBe("gemini");
    unmount();
    render(<App store={store} />);
    await screen.findByText("Tailored for Chennai");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the plan usable when tailoring fails", async () => {
    mockAi({});
    render(<App store={seededStore()} />);
    await goTo(planHref("plan-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("ran into a problem");
    expect(screen.getByRole("heading", { name: /Readiness/ })).toBeInTheDocument();

    mockAi({ personalize: personalizeReply });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Tailored for Chennai")).toBeInTheDocument();
  });

  it("does not update the plan if the user leaves while tailoring runs", async () => {
    let release: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const store = seededStore();
    const { unmount } = render(<App store={store} />);
    await goTo(planHref("plan-1"));
    await screen.findByText(/tailoring your plan/);
    unmount();
    release(
      new Response(
        JSON.stringify({
          source: "gemini",
          sanitized: false,
          cached: false,
          data: personalizeReply,
        }),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getPlan("plan-1")?.personalization).toBeNull();
  });
});
