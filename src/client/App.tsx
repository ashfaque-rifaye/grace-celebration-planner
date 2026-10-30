import { lazy, Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { ArrowLeft, ShieldCheck, Sparkles } from "lucide-react";
import { AnnouncerProvider } from "./lib/announcer";
import { parseRoute } from "./lib/route";
import type { PlanStore } from "./lib/plan-store";
import { HomePage } from "./components/HomePage";

// The workspace is most of the UI code, so the first screen does not pay for it.
const PlanWorkspace = lazy(() =>
  import("./components/PlanWorkspace").then((module) => ({ default: module.PlanWorkspace })),
);

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function App({ store }: { store: PlanStore }) {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  const route = useMemo(() => parseRoute(hash), [hash]);
  const plans = useSyncExternalStore(store.subscribe, store.getPlans);
  const plan =
    route.name === "plan" ? plans.find((candidate) => candidate.id === route.planId) : undefined;
  const mainRef = useRef<HTMLElement>(null);
  const screen = route.name === "plan" ? route.planId : "home";

  useEffect(() => {
    document.title = plan ? `${plan.brief.title} | Grace` : "Grace, your celebration planner";
  }, [plan]);

  // A hash change is invisible to assistive tech, so move focus to the new screen
  // (but not on first load, where the browser's default is right).
  const previousScreen = useRef(screen);
  useEffect(() => {
    if (previousScreen.current !== screen) {
      previousScreen.current = screen;
      mainRef.current?.focus();
      window.scrollTo?.(0, 0);
    }
  }, [screen]);

  return (
    <AnnouncerProvider>
      <a className="skip-link" href="#main" onClick={() => mainRef.current?.focus()}>
        Skip to main content
      </a>
      <header className="site-header">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <span>Grace</span>
        </a>
        <p className="site-tagline">Your celebration planner</p>
        {route.name === "plan" ? (
          <a className="button button-quiet header-link" href="#/">
            <ArrowLeft aria-hidden="true" size={16} />
            All events
          </a>
        ) : null}
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="site-main">
        {route.name === "plan" && plan ? (
          <Suspense fallback={<p role="status">Opening your plan…</p>}>
            <PlanWorkspace plan={plan} tab={route.tab} store={store} />
          </Suspense>
        ) : route.name === "plan" ? (
          <div className="empty-state container">
            <h1>We could not find that plan</h1>
            <p>Plans are stored in the browser where they were made. It may be in another one.</p>
            <a className="button button-primary" href="#/">
              Back to home
            </a>
          </div>
        ) : (
          <HomePage store={store} plans={plans} />
        )}
      </main>
      <footer className="site-footer">
        <p>
          <ShieldCheck aria-hidden="true" size={16} />
          Your plans stay in this browser. Grace only sends the AI what it needs, and never your
          vendors&apos; contact details.
        </p>
      </footer>
    </AnnouncerProvider>
  );
}
