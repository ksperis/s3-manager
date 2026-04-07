import { expect, test } from "@playwright/test";

import { openBucket, openFolder } from "../helpers/browser";

test("navigates to a seeded object and shows metadata in Details", async ({ page }) => {
  await openBucket(page);
  await openFolder(page, "navigation");
  await openFolder(page, "daily");

  const objectRow = page.locator("tr").filter({
    has: page.getByRole("button", { name: "report-2026-03-08.json", exact: true }),
  });
  await objectRow.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu").getByRole("button", { name: "Details" }).click();

  const detailsPanel = page.getByRole("tabpanel", { name: "Details" });
  await expect(detailsPanel).toContainText("report-2026-03-08.json");
  await expect(detailsPanel).toContainText("Content type");
  await expect(detailsPanel).toContainText("application/json");
});
