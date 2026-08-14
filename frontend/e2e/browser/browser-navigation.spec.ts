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

  const detailsDialog = page.getByRole("dialog", {
    name: "Object details · report-2026-03-08.json",
  });
  await expect(detailsDialog).toBeVisible();
  await expect(
    detailsDialog.getByRole("tab", { name: "Properties" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(detailsDialog).toContainText("Standard metadata");
  await expect(detailsDialog).toContainText("Content type");
  await expect(detailsDialog).toContainText("Storage class");
});
