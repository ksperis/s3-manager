import { expect, test } from "@playwright/test";

import { getFileButton, openBucket, openFolder } from "../helpers/browser";

test("opens object versions for a versioned Moto object", async ({ page }) => {
  await openBucket(page);
  await openFolder(page, "versions");

  const objectRow = page.locator("tr").filter({
    has: getFileButton(page, "report.json"),
  });
  await objectRow.getByRole("checkbox", { name: "Select report.json" }).check();
  await page
    .getByRole("toolbar", { name: "Browser context bar" })
    .getByRole("button", { name: "Open", exact: true })
    .click();

  const versionsDrawer = page.getByRole("complementary", {
    name: "report.json",
    exact: true,
  });
  await expect(versionsDrawer).toBeVisible();
  const versionsTab = versionsDrawer.getByRole("tab", { name: "Versions" });
  await versionsTab.click();
  await expect(versionsTab).toHaveAttribute("aria-selected", "true");
  await expect(versionsDrawer).toContainText("Versions");
  const restoreButtons = versionsDrawer.getByRole("button", { name: "Restore" });
  await expect(restoreButtons).toHaveCount(2);
});
