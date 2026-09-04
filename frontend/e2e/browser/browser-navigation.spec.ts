import { expect, test } from "@playwright/test";

import { getFileButton, openBucket, openFolder } from "../helpers/browser";

test("navigates to a seeded object and exposes metadata from Details", async ({
  page,
}) => {
  await openBucket(page);
  await openFolder(page, "navigation");
  await openFolder(page, "daily");

  const objectRow = page.locator("tr").filter({
    has: getFileButton(page, "report-2026-03-08.json"),
  });
  await objectRow.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu").getByRole("button", { name: "Properties" }).click();

  const detailsDrawer = page.getByRole("complementary", {
    name: "report-2026-03-08.json",
    exact: true,
  });
  await expect(detailsDrawer).toBeVisible();
  await expect(
    detailsDrawer.getByRole("tab", { name: "Properties" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(detailsDrawer).toContainText("Standard metadata");
  await expect(detailsDrawer).toContainText("Content type");
  await expect(detailsDrawer).toContainText("Storage class");
});
