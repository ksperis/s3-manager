import { expect, test } from "@playwright/test";

test("uses portal workspace headers for a portal project browser context", async ({ page }) => {
  const portalRequests: string[] = [];

  await page.route("**/api/me/execution-contexts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          kind: "portal_project",
          id: "proj-42",
          display_name: "Genome Project",
          account_role: "portal_manager",
          endpoint_name: "2 project accounts",
          tags: [],
          endpoint_tags: [],
          capabilities: {
            can_manage_iam: false,
            sts_capable: false,
            admin_api_capable: false,
          },
        },
      ]),
    });
  });

  await page.route("**/api/browser/settings**", async (route) => {
    const request = route.request();
    if (request.url().includes("account_id=proj-42")) {
      portalRequests.push(request.url());
      expect(request.headers()["x-s3-workspace"]).toBe("portal");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        allow_proxy_transfers: true,
        direct_upload_parallelism: 4,
        proxy_upload_parallelism: 2,
        direct_download_parallelism: 4,
        proxy_download_parallelism: 2,
        other_operations_parallelism: 4,
        streaming_zip_threshold_mb: 512,
      }),
    });
  });

  await page.route("**/api/browser/usage-summary**", async (route) => {
    const request = route.request();
    if (request.url().includes("account_id=proj-42")) {
      portalRequests.push(request.url());
      expect(request.headers()["x-s3-workspace"]).toBe("portal");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        source: "portal_project",
        label: "Genome Project",
        used_bytes: 0,
        object_count: 0,
      }),
    });
  });

  await page.route("**/api/browser/buckets/search**", async (route) => {
    const request = route.request();
    if (request.url().includes("account_id=proj-42")) {
      portalRequests.push(request.url());
      expect(request.headers()["x-s3-workspace"]).toBe("portal");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            name: "space-a",
            display_name: "Lab Paris",
            workspace_label: "Paris",
          },
        ],
        total: 1,
        page: 1,
        page_size: 25,
        has_next: false,
      }),
    });
  });

  await page.route("**/api/browser/buckets/space-a/objects**", async (route) => {
    const request = route.request();
    if (request.url().includes("account_id=proj-42")) {
      portalRequests.push(request.url());
      expect(request.headers()["x-s3-workspace"]).toBe("portal");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        prefix: "",
        objects: [],
        prefixes: [],
        is_truncated: false,
      }),
    });
  });

  await page.goto("/browser?ctx=proj-42&bucket=space-a");

  await expect(page.getByRole("button", { name: "Select storage space" })).toContainText("Lab Paris");
  await expect.poll(() => portalRequests.length).toBeGreaterThan(0);
});
