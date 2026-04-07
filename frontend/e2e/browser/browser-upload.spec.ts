import { expect, test } from "@playwright/test";

import { openBucket, openFolder } from "../helpers/browser";
import { E2E_UPLOAD_FIXTURE_PATH } from "../helpers/config";

const uploadFolderName = "upload-target";

test("creates a folder and uploads a file through the browser flow", async ({ page }) => {
  await openBucket(page);

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog", { name: "Create folder" }).getByPlaceholder("my-folder").fill(uploadFolderName);
  await page.getByRole("dialog", { name: "Create folder" }).getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("button", { name: uploadFolderName, exact: true })).toBeVisible();

  await openFolder(page, uploadFolderName);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("toolbar", { name: "Browser context bar" })
    .getByRole("button", { name: "Upload", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Upload files" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(E2E_UPLOAD_FIXTURE_PATH);

  await expect(page.getByRole("button", { name: "upload-smoke.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Operations" }).click();
  const operationsDialog = page.getByRole("dialog", { name: "Operations overview" });
  await operationsDialog.getByRole("button", { name: "Show files" }).click();
  await expect(operationsDialog).toContainText("upload-smoke.txt");
});
