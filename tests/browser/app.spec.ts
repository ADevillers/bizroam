import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  page.on("pageerror", (error) =>
    console.error("Browser error:", error.message),
  );
});
test("private login, preferences, exploration, sourced card and persistent history", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
  await page.getByLabel("Access password").fill("e2e-password");
  await page.getByRole("button", { name: "Let’s explore" }).click();
  await expect(
    page.getByRole("heading", { name: "Around the corner.", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Add an interest").fill("Robotics");
  await page.getByRole("button", { name: "Add interest", exact: true }).click();
  await page.getByRole("button", { name: "Save my preferences" }).click();
  await expect(page.getByLabel("Map of nearby companies")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "OpenStreetMap contributors" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start exploring" }).click();
  await expect(
    page
      .locator(".company-map-label")
      .filter({ hasText: "Fieldwork Robotics" }),
  ).toContainText("$250M valuation");
  if (info.project.name !== "desktop-chromium")
    await page.getByRole("button", { name: "Expand discoveries" }).click();
  await expect(
    page.getByRole("heading", { name: "Fieldwork Robotics" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Fieldwork Robotics.*15|Fieldwork Robotics/ })
    .filter({ has: page.locator("h3") })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Company profile" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Company website" }),
  ).toHaveAttribute("href", "https://example.com/about");
  await page.getByRole("button", { name: "Close company profile" }).click();
  await page.getByRole("button", { name: /Passed by/ }).click();
  await expect(
    page.getByRole("heading", { name: "Fieldwork Robotics" }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  if (info.project.name !== "desktop-chromium")
    await page.getByRole("button", { name: "Expand discoveries" }).click();
  await page.getByRole("button", { name: /Passed by/ }).click();
  await expect(
    page.getByRole("heading", { name: "Fieldwork Robotics" }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-explore.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Robotics", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close preferences" }).click();
  await page.getByRole("button", { name: "Clear your collection" }).click();
  await expect(
    page.getByRole("heading", { name: "A little trail of discovery." }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  if (info.project.name !== "desktop-chromium")
    await page.getByRole("button", { name: "Expand discoveries" }).click();
  await page.getByRole("button", { name: /Passed by/ }).click();
  await expect(
    page.getByRole("heading", { name: "A little trail of discovery." }),
  ).toBeVisible();
});
test("wrong password reveals no protected data", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Access password").fill("incorrect");
  await page.getByRole("button", { name: "Let’s explore" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That password does not match.",
  );
  const r = await page.request.get("/api/config");
  expect(r.status()).toBe(401);
});
test("judge invitation signs in once, clears the URL and does not start research", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  let logins = 0,
    walks = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/login")) logins++;
    if (request.url().endsWith("/api/walks") && request.method() === "POST")
      walks++;
  });
  await page.goto("/#password=e2e-password");
  await expect(
    page.getByRole("heading", { name: "Around the corner.", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(logins).toBe(1);
  expect(walks).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Around the corner.", exact: true }),
  ).toBeVisible();
  expect(logins).toBe(1);
  await page.goto("/#password=e2e-password");
  await expect(
    page.getByRole("heading", { name: "Around the corner.", exact: true }),
  ).toBeVisible();
  expect(logins).toBe(1);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Welcome to/ })).toBeVisible();
  expect(logins).toBe(1);
  expect(browserErrors).toEqual([]);
});
test("invalid judge invitation keeps authentication and manual login intact", async ({
  page,
}) => {
  await page.goto("/#password=incorrect-invitation");
  await expect(page.getByRole("alert")).toHaveText(
    "That password does not match.",
  );
  expect(new URL(page.url()).hash).toBe("");
  expect((await page.request.get("/api/config")).status()).toBe(401);
  await page.getByLabel("Access password").fill("e2e-password");
  await page.getByRole("button", { name: "Let’s explore" }).click();
  await expect(
    page.getByRole("heading", { name: "Around the corner.", exact: true }),
  ).toBeVisible();
});
