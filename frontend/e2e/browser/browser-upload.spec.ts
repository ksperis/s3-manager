import { expect, test, type Page } from "@playwright/test";

import {
  getFileButton,
  getFolderButton,
  openBucket,
  openFolder,
  openOperationsOverview,
} from "../helpers/browser";
import { E2E_BUCKET_NAME, E2E_UPLOAD_FIXTURE_PATH } from "../helpers/config";

const uploadFolderName = "upload-target";

async function createFolder(page: Page, folderName: string): Promise<void> {
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "Create folder" });
  await dialog.getByPlaceholder("my-folder").fill(folderName);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(getFolderButton(page, folderName)).toBeVisible();
}

async function uploadFilePayloads(
  page: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
): Promise<void> {
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("toolbar", { name: "Browser context bar" })
    .getByRole("button", { name: "Upload", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Upload files" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(files);
}

async function refreshObjects(page: Page): Promise<void> {
  await page
    .getByRole("toolbar", { name: "Browser context bar" })
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
}

test("creates a folder and uploads a file through the browser flow", async ({ page }) => {
  await openBucket(page);

  await createFolder(page, uploadFolderName);

  await openFolder(page, uploadFolderName);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("toolbar", { name: "Browser context bar" })
    .getByRole("button", { name: "Upload", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Upload files" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(E2E_UPLOAD_FIXTURE_PATH);

  await expect(getFileButton(page, "upload-smoke.txt")).toBeVisible();
  const operationsDialog = await openOperationsOverview(page);
  await operationsDialog.getByRole("button", { name: "Show files" }).click();
  await expect(operationsDialog).toContainText("upload-smoke.txt");
});

test("keeps root uploads visible after refresh, search, and reload", async ({ page }) => {
  await openBucket(page);

  const fileNames = [
    "root-refresh-alpha.txt",
    "root-refresh-beta.txt",
    "root-refresh-gamma.txt",
  ];
  await uploadFilePayloads(
    page,
    fileNames.map((name, index) => ({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`root upload ${index}\n`),
    })),
  );

  for (const name of fileNames) {
    await expect(getFileButton(page, name)).toBeVisible();
  }

  await refreshObjects(page);
  for (const name of fileNames) {
    await expect(getFileButton(page, name)).toBeVisible();
  }

  await page.getByRole("textbox", { name: "Search objects" }).fill("root-refresh");
  for (const name of fileNames) {
    await expect(getFileButton(page, name)).toBeVisible();
  }

  await page.goto(`/browser?bucket=${encodeURIComponent(E2E_BUCKET_NAME)}`);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(E2E_BUCKET_NAME);
  for (const name of fileNames) {
    await expect(getFileButton(page, name)).toBeVisible();
  }
});

test("keeps repeated nested uploads visible while navigating between prefixes", async ({ page }) => {
  await openBucket(page);
  const folderName = "upload-refresh-stress";
  await createFolder(page, folderName);
  await openFolder(page, folderName);

  const fileNames = Array.from({ length: 5 }, (_, index) => `stress-${index + 1}.txt`);
  for (const name of fileNames) {
    await uploadFilePayloads(page, [
      {
        name,
        mimeType: "text/plain",
        buffer: Buffer.from(`nested upload ${name}\n`),
      },
    ]);
    await expect(getFileButton(page, name)).toBeVisible();
  }

  await refreshObjects(page);
  for (const name of fileNames) {
    await expect(getFileButton(page, name)).toBeVisible();
  }

  await page
    .getByRole("toolbar", { name: "Browser context bar" })
    .getByRole("button", { name: "Parent folder", exact: true })
    .click();
  await expect(getFolderButton(page, folderName)).toBeVisible();
  await openFolder(page, folderName);
  for (const name of fileNames) {
    await expect(getFileButton(page, name)).toBeVisible();
  }
});

test("deletes freshly uploaded files from the current prefix", async ({ page }) => {
  await openBucket(page);
  const folderName = "upload-delete-target";
  await createFolder(page, folderName);
  await openFolder(page, folderName);

  const fileNames = ["delete-after-upload-a.txt", "delete-after-upload-b.txt"];
  await uploadFilePayloads(
    page,
    fileNames.map((name) => ({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`delete candidate ${name}\n`),
    })),
  );

  for (const name of fileNames) {
    await expect(getFileButton(page, name)).toBeVisible();
    await page.getByRole("checkbox", { name: `Select ${name}` }).check();
  }

  await page
    .getByRole("toolbar", { name: "Browser actions bar" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();

  const confirmDialog = page.getByRole("dialog", { name: "Delete objects" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Deleted 2 object(s)")).toBeVisible();
  for (const name of fileNames) {
    await expect(getFileButton(page, name)).toHaveCount(0);
  }
});
