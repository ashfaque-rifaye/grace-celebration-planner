/**
 * Plans live in this browser and nowhere else: there is no account and no
 * database, which is a privacy feature as well as a simplification.
 *
 * Everything read back from storage is re-validated, because localStorage is
 * user-editable and a future version may read an older shape. A corrupt entry is
 * skipped, never fatal. Writes are debounced so typing in a field does not
 * serialise every plan on each keystroke.
 */
import { todayIso } from "../../shared/dates";
import { planReducer, type PlanAction } from "../../shared/plan";
import { planSchema, type Plan } from "../../shared/schemas";

const STORAGE_KEY = "grace.plans.v1";
const SAVE_DEBOUNCE_MS = 250;
export const MAX_IMPORT_BYTES = 1_000_000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage can throw in private windows, so fall back to session memory. */
export function createBrowserStorage(): StorageLike {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
  };
}

function readPlans(storage: StorageLike): Plan[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const result = planSchema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export type ImportResult = { ok: true; plan: Plan } | { ok: false; error: string };

/** Parse an uploaded backup. The file is untrusted, so it gets the full schema. */
export function parsePlanBackup(text: string): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: "That file is too large to be a Grace backup." };
  }
  try {
    const result = planSchema.safeParse(JSON.parse(text));
    if (result.success) return { ok: true, plan: result.data };
    return { ok: false, error: "That file is not a valid Grace plan backup." };
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
}

export interface PlanStore {
  subscribe(listener: () => void): () => void;
  getPlans(): readonly Plan[];
  getPlan(id: string): Plan | undefined;
  add(plan: Plan): void;
  remove(id: string): void;
  dispatch(id: string, action: PlanAction): void;
  flush(): void;
}

export function createPlanStore(
  storage: StorageLike,
  clock: () => Date = () => new Date(),
): PlanStore {
  let plans: readonly Plan[] = readPlans(storage);
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    storage.setItem(STORAGE_KEY, JSON.stringify(plans));
  }

  function commit(next: readonly Plan[]): void {
    plans = next;
    listeners.forEach((listener) => listener());
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getPlans: () => plans,
    getPlan: (id) => plans.find((plan) => plan.id === id),
    add(plan) {
      commit([plan, ...plans.filter((existing) => existing.id !== plan.id)]);
    },
    remove(id) {
      commit(plans.filter((plan) => plan.id !== id));
    },
    dispatch(id, action) {
      const now = clock();
      commit(
        plans.map((plan) =>
          plan.id === id
            ? { ...planReducer(plan, action, todayIso(now)), updatedAt: now.toISOString() }
            : plan,
        ),
      );
    },
    flush,
  };
}
