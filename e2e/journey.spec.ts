import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const DATE = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);

async function createPlan(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Event name").fill("Meena's 60th");
  await page.getByRole("radio", { name: "Birthday" }).check();
  await page.getByLabel("Date", { exact: true }).fill(DATE);
  await page.getByLabel("Number of guests").fill("60");
  await page.getByLabel("Total budget").fill("250000");
  await page
    .getByLabel(/Anything Grace should know/)
    .fill("Vegetarian. Two guests use wheelchairs.");
  await page.getByRole("button", { name: "Create my plan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Meena's 60th" })).toBeVisible();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

const TABS = ["Overview", "Budget", "Timeline", "Vendors", "Ideas", "Ask Grace"];

test("a person can plan an event end to end on the offline planner", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Try: A birthday" }).click();
  await page.getByRole("button", { name: /Fill in the details/ }).click();
  await expect(page.getByTestId("brief-result").getByTestId("ai-source")).toHaveText(
    "Offline planner",
  );
  await expect(page.getByLabel("Number of guests")).toHaveValue("35");
  await expect(page.getByRole("radio", { name: "Birthday" })).toBeChecked();

  await page.getByLabel("Event name").fill("Rooftop 40th");
  await page.getByLabel("Date", { exact: true }).fill(DATE);
  await page.getByRole("button", { name: "Create my plan" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Rooftop 40th" })).toBeVisible();
  await expect(page.getByTestId("personalization")).toContainText("Offline planner");
  await expect(page.getByRole("heading", { name: /Readiness/ })).toBeVisible();

  await page.getByRole("tab", { name: "Budget" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Review my budget" }).click();
  await expect(page.getByTestId("budget-review")).toContainText("biggest line");

  await page.getByRole("tab", { name: "Timeline" }).click();
  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("heading", { name: /^1 of \d+ tasks done/ })).toBeVisible();
  await page.getByRole("button", { name: "Write my run sheet" }).click();
  await expect(page.getByTestId("run-sheet")).toContainText("Guests arrive");

  await page.getByRole("tab", { name: "Vendors" }).click();
  await page.getByRole("button", { name: "What should I ask them?" }).first().click();
  await expect(page.getByTestId("vendor-brief").first()).toContainText("Questions to ask");

  await page.getByRole("tab", { name: "Ideas" }).click();
  await page.getByRole("button", { name: "Get ideas" }).click();
  await expect(page.getByTestId("ideas").getByRole("listitem").first()).toBeVisible();

  await page.getByRole("tab", { name: "Ask Grace" }).click();
  await page.getByLabel("Your question").fill("What is my backup if it rains?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("proposal")).toBeVisible();
  await page.getByRole("button", { name: /^Apply/ }).click();
  await expect(page.getByTestId("proposal")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Rooftop 40th" })).toBeVisible();
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByText("Confirm a backup plan with the venue")).toBeVisible();

  // Nothing should trip the strict CSP or log an error along the way.
  expect(consoleErrors).toEqual([]);
});

test("the form reports errors and recovers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create my plan" }).click();
  const summary = page.getByRole("alert");
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("Give your event a name");
  await summary.getByRole("link", { name: "Give your event a name" }).click();
  await expect(page.getByLabel("Event name")).toBeFocused();
});

test("the AI path shows provenance and needs approval to change anything", async ({ page }) => {
  await page.route("**/api/ai/chat", (route) =>
    route.fulfill({
      json: {
        source: "gemini",
        sanitized: false,
        cached: false,
        data: {
          reply: "Move a little from decorations to food.",
          reasoning: "You said food matters most.",
          proposals: [
            { type: "moveBudget", from: "decor", to: "catering", amount: 1000, why: "Food first" },
          ],
        },
      },
    }),
  );
  await createPlan(page);
  await page.getByRole("tab", { name: "Ask Grace" }).click();
  await page.getByLabel("Your question").fill("What should I cut?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("ai-source")).toHaveText("AI · Gemini");
  await expect(page.getByText("Why:").last()).toBeVisible();

  await page.getByRole("tab", { name: "Budget" }).click();
  const before = await page.getByLabel("Allocated to Food & drink").inputValue();
  await page.getByRole("tab", { name: "Ask Grace" }).click();
  await page.getByRole("button", { name: /^Apply/ }).click();
  await page.getByRole("tab", { name: "Budget" }).click();
  await expect(page.getByLabel("Allocated to Food & drink")).toHaveValue(
    String(Number(before) + 1000),
  );
});

test("every screen passes an axe scan, including contrast, in both themes", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expectNoAxeViolations(page);
    await createPlan(page);
    for (const tab of TABS) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel").getByRole("heading").first()).toBeAttached();
      await expectNoAxeViolations(page);
    }
    await page.evaluate(() => window.localStorage.clear());
  }
});

test("the tabs work with a keyboard", async ({ page }) => {
  await createPlan(page);
  await page.getByRole("tab", { name: "Overview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Budget" })).toBeFocused();
  await expect(page.getByRole("table")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Ask Grace" })).toBeFocused();
});

test("the skip link appears on focus and reaches the content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("the layout fits a phone with no sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto("/");
  expect(await overflow()).toBeLessThanOrEqual(0);
  await createPlan(page);
  for (const tab of TABS) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    expect(await overflow()).toBeLessThanOrEqual(0);
  }
});

test("the server sends strict security headers and hides nothing useful", async ({ request }) => {
  const page = await request.get("/");
  expect(page.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  expect(page.headers()["x-frame-options"]).toBe("DENY");

  const crossSite = await request.post("/api/ai/brief", {
    headers: { origin: "https://evil.example" },
    data: { text: "a party" },
  });
  expect(crossSite.status()).toBe(403);

  const tooBig = await request.post("/api/ai/brief", {
    data: { text: "x".repeat(70_000) },
  });
  expect(tooBig.status()).toBe(413);
});

test("no secret or provider host reaches the browser bundle", async ({ page, request }) => {
  await page.goto("/");
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".js")),
  );
  expect(scripts.length).toBeGreaterThan(0);
  for (const url of scripts) {
    const body = await (await request.get(url)).text();
    expect(body).not.toContain("generativelanguage.googleapis.com");
    expect(body).not.toContain("GEMINI_API_KEY");
  }
});
