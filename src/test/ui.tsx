import { render } from "@testing-library/react";
import axe from "axe-core";
import { useSyncExternalStore, type ComponentType } from "react";
import { vi } from "vitest";
import type { PanelProps } from "../client/components/PlanWorkspace";
import { AnnouncerProvider } from "../client/lib/announcer";
import { createPlanStore, type StorageLike } from "../client/lib/plan-store";
import type { AiEnvelope, AiFeatureName } from "../shared/contracts";
import { todayIso } from "../shared/dates";
import type { Plan } from "../shared/schemas";

export function memoryStorage(initial?: string): StorageLike & { saved: () => string | null } {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    saved: () => value,
  };
}

/** Render a panel against a real store, so its dispatches really change the plan. */
export function renderPanel(Panel: ComponentType<PanelProps>, plan: Plan) {
  const store = createPlanStore(memoryStorage());
  store.add(plan);

  function Harness() {
    const plans = useSyncExternalStore(store.subscribe, store.getPlans);
    const current = plans.find((candidate) => candidate.id === plan.id) as Plan;
    return (
      <AnnouncerProvider>
        <main>
          <Panel
            plan={current}
            today={todayIso()}
            dispatch={(action) => store.dispatch(plan.id, action)}
          />
        </main>
      </AnnouncerProvider>
    );
  }

  const view = render(<Harness />);
  return { ...view, store, getPlan: () => store.getPlan(plan.id) as Plan };
}

type Responder<F extends AiFeatureName> =
  AiEnvelope<F>["data"] | ((body: unknown) => AiEnvelope<F>["data"]);

export type AiMockSpec = { [F in AiFeatureName]?: Responder<F> };

/** Stub the AI endpoint. Unlisted features fail, which keeps tests honest. */
export function mockAi(spec: AiMockSpec, meta: Partial<AiEnvelope<AiFeatureName>> = {}) {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const feature = String(url).split("/").pop() as AiFeatureName;
    const responder = spec[feature] as Responder<AiFeatureName> | undefined;
    if (!responder) return new Response("{}", { status: 500 });
    const body: unknown = JSON.parse(String(init?.body));
    const data = typeof responder === "function" ? responder(body) : responder;
    return new Response(
      JSON.stringify({ source: "gemini", sanitized: false, cached: false, ...meta, data }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The input a given feature was last called with. */
export function lastBody(fetchMock: ReturnType<typeof mockAi>): unknown {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body));
}

/**
 * Run axe against rendered output. jsdom has no layout, so colour contrast is
 * checked separately: in tokens.test.ts and in the real-browser Playwright scans.
 */
export async function a11yViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes[0]?.html ?? ""}`,
  );
}
