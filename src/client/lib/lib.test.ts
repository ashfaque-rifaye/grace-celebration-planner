/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePlan } from "../../test/fixtures";
import { memoryStorage } from "../../test/ui";
import { planToJson } from "../../shared/exports";
import { AiRequestError, callAi } from "./api";
import { downloadText, slugify } from "./download";
import {
  createBrowserStorage,
  createPlanStore,
  MAX_IMPORT_BYTES,
  parsePlanBackup,
} from "./plan-store";
import { navigate, parseRoute, planHref } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("routes", () => {
  it.each([
    ["", { name: "home" }],
    ["#/", { name: "home" }],
    ["#/plans/abc-123", { name: "plan", planId: "abc-123", tab: "overview" }],
    ["#/plans/abc/budget", { name: "plan", planId: "abc", tab: "budget" }],
    ["#/plans/abc/assistant", { name: "plan", planId: "abc", tab: "assistant" }],
    ["#/plans/abc/nonsense", { name: "plan", planId: "abc", tab: "overview" }],
    ["#/plans/<script>", { name: "home" }],
    ["#/elsewhere", { name: "home" }],
  ])("parses %j", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it("round-trips an href", () => {
    expect(parseRoute(planHref("abc", "ideas"))).toEqual({
      name: "plan",
      planId: "abc",
      tab: "ideas",
    });
    expect(planHref("abc")).toBe("#/plans/abc/overview");
  });

  it("navigates by changing the hash", () => {
    navigate("#/plans/abc/budget");
    expect(window.location.hash).toBe("#/plans/abc/budget");
    window.location.hash = "";
  });
});

describe("createPlanStore", () => {
  it("starts empty and reads back what it saved", () => {
    const storage = memoryStorage();
    const store = createPlanStore(storage);
    expect(store.getPlans()).toEqual([]);
    store.add(makePlan());
    store.flush();
    expect(createPlanStore(storage).getPlan("plan-1")?.brief.title).toBe("Asha & Ravi's Wedding");
  });

  it("debounces writes so typing does not serialise on every keystroke", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const store = createPlanStore(storage);
    store.add(makePlan());
    store.dispatch("plan-1", { type: "addTask", title: "A", due: "2027-01-01" });
    store.dispatch("plan-1", { type: "addTask", title: "B", due: "2027-01-01" });
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(setItem).toHaveBeenCalledOnce();
  });

  it("flush with nothing pending does nothing", () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    createPlanStore(storage).flush();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("notifies subscribers, and stops after unsubscribe", () => {
    const store = createPlanStore(memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.add(makePlan());
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    store.remove("plan-1");
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getPlans()).toEqual([]);
  });

  it("stamps updatedAt on a change and only touches the target plan", () => {
    const clock = () => new Date("2027-01-01T00:00:00.000Z");
    const store = createPlanStore(memoryStorage(), clock);
    store.add(makePlan());
    store.add({ ...makePlan(), id: "plan-2" });
    store.dispatch("plan-1", { type: "addTask", title: "A", due: "2027-02-01" });
    expect(store.getPlan("plan-1")?.updatedAt).toBe("2027-01-01T00:00:00.000Z");
    expect(store.getPlan("plan-2")?.updatedAt).toBe("2026-11-01T10:00:00.000Z");
  });

  it("re-adding a plan replaces it rather than duplicating it", () => {
    const store = createPlanStore(memoryStorage());
    store.add(makePlan());
    store.add(makePlan({ title: "Renamed" }));
    expect(store.getPlans()).toHaveLength(1);
    expect(store.getPlans()[0]?.brief.title).toBe("Renamed");
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["the wrong shape", '{"a":1}'],
    ["a tampered plan", '[{"id":"x","version":1}]'],
  ])("survives %s in storage", (_name, stored) => {
    expect(createPlanStore(memoryStorage(stored)).getPlans()).toEqual([]);
  });

  it("keeps valid plans next to a corrupt one", () => {
    const stored = JSON.stringify([makePlan(), { id: "broken" }]);
    expect(createPlanStore(memoryStorage(stored)).getPlans()).toHaveLength(1);
  });
});

describe("createBrowserStorage", () => {
  it("uses localStorage when it works", () => {
    const storage = createBrowserStorage();
    storage.setItem("grace-test", "1");
    expect(storage.getItem("grace-test")).toBe("1");
    window.localStorage.removeItem("grace-test");
  });

  it("falls back to memory when localStorage throws, as in a private window", () => {
    const denied = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
    const storage = createBrowserStorage();
    expect(storage.getItem("k")).toBeNull();
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
  });
});

describe("parsePlanBackup", () => {
  it("accepts a real backup", () => {
    const result = parsePlanBackup(planToJson(makePlan()));
    expect(result.ok).toBe(true);
  });

  it.each([
    ["not JSON", "hello", "not valid JSON"],
    ["JSON of another shape", '{"hello":"world"}', "not a valid Grace plan"],
    ["too large", "x".repeat(MAX_IMPORT_BYTES + 1), "too large"],
  ])("rejects %s", (_name, text, message) => {
    const result = parsePlanBackup(text);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error).toContain(message);
  });

  it("rejects a backup with an impossible date", () => {
    const plan = makePlan();
    const tampered = { ...plan, brief: { ...plan.brief, date: "2026-02-31" } };
    expect(parsePlanBackup(JSON.stringify(tampered)).ok).toBe(false);
  });
});

describe("callAi", () => {
  const data = { brief: {}, assumptions: [], questions: [], reasoning: "r" };
  const envelope = { source: "gemini", sanitized: false, cached: false, data };

  it("posts JSON to the feature's endpoint and returns the envelope", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(envelope)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callAi("brief", { text: "a party" });
    expect(result.source).toBe("gemini");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/ai/brief");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"text":"a party"}');
  });

  it("treats a 429 with a fallback as a real answer", async () => {
    const limited = { ...envelope, source: "fallback", fallbackReason: "rate-limited" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(limited), { status: 429 })),
    );
    expect((await callAi("brief", { text: "party" })).fallbackReason).toBe("rate-limited");
  });

  it.each([
    [400, "could not read"],
    [500, "ran into a problem"],
  ])("explains a %i in plain language", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status })),
    );
    await expect(callAi("brief", { text: "party" })).rejects.toThrow(message);
  });

  it("explains a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("failed");
      }),
    );
    await expect(callAi("brief", { text: "party" })).rejects.toBeInstanceOf(AiRequestError);
  });

  it("lets a cancellation through untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(callAi("brief", { text: "party" })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a reply that breaks the contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"source":"gemini"}')),
    );
    await expect(callAi("brief", { text: "party" })).rejects.toThrow("unexpected reply");
  });

  it("rejects a reply that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>")),
    );
    await expect(callAi("brief", { text: "party" })).rejects.toThrow("unexpected reply");
  });
});

describe("downloads", () => {
  it("makes a safe filename", () => {
    expect(slugify("Asha & Ravi's Wedding!")).toBe("asha-ravi-s-wedding");
    expect(slugify("விழா")).toBe("event");
  });

  it("creates and releases an object URL", () => {
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    downloadText("a.txt", "hello", "text/plain");
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
