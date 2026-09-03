import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
}));

import {
  createBrowserBucket,
  ensureBrowserBucketCors,
  fetchBrowserSettings,
  fetchBrowserUsageSummary,
  getBrowserBucketCorsStatus,
  getBrowserBucketVersioning,
  searchBrowserBuckets,
} from "./browserBuckets";

describe("browser bucket api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.get.mockResolvedValue({ data: {} });
    clientMock.post.mockReset();
    clientMock.post.mockResolvedValue({ data: {} });
  });

  it("searches the explicit Browser workspace with normalized parameters", async () => {
    await searchBrowserBuckets("account-1", {
      search: "  reports  ",
      exact: true,
      page: 2,
      pageSize: 25,
      workspaceSurface: "browser",
    });

    expect(clientMock.get).toHaveBeenCalledWith("/browser/buckets/search", {
      params: {
        account_id: "account-1",
        search: "reports",
        exact: true,
        page: 2,
        page_size: 25,
      },
      headers: {},
    });
  });

  it("uses the Portal workspace for bucket runtime reads", async () => {
    const options = { workspaceSurface: "portal" as const };

    await fetchBrowserSettings("101", options);
    await fetchBrowserUsageSummary("101", options);
    await getBrowserBucketVersioning("101", "research data", options);
    await getBrowserBucketCorsStatus(
      "101",
      "research data",
      "https://portal.example.test",
      options,
    );

    expect(clientMock.get).toHaveBeenNthCalledWith(1, "/browser/settings", {
      params: { account_id: "101" },
      headers: { "X-S3-Workspace": "portal" },
    });
    expect(clientMock.get).toHaveBeenNthCalledWith(
      2,
      "/browser/usage-summary",
      {
        params: { account_id: "101" },
        headers: { "X-S3-Workspace": "portal" },
      },
    );
    expect(clientMock.get).toHaveBeenNthCalledWith(
      3,
      "/browser/buckets/research%20data/versioning",
      {
        params: { account_id: "101" },
        headers: { "X-S3-Workspace": "portal" },
      },
    );
    expect(clientMock.get).toHaveBeenNthCalledWith(
      4,
      "/browser/buckets/research%20data/cors",
      {
        params: {
          account_id: "101",
          origin: "https://portal.example.test",
        },
        headers: { "X-S3-Workspace": "portal" },
      },
    );
  });

  it("uses the Manager Browser workspace for bucket mutations", async () => {
    const options = { workspaceSurface: "manager" as const };

    await createBrowserBucket("12", "bucket-a", {
      versioning: true,
      ...options,
    });
    await ensureBrowserBucketCors(
      "12",
      "bucket-a",
      "https://manager.example.test",
      options,
    );

    expect(clientMock.post).toHaveBeenNthCalledWith(
      1,
      "/browser/buckets",
      { name: "bucket-a", versioning: true },
      {
        params: { account_id: "12" },
        headers: { "X-S3-Workspace": "manager-browser" },
      },
    );
    expect(clientMock.post).toHaveBeenNthCalledWith(
      2,
      "/browser/buckets/bucket-a/cors/ensure",
      { origin: "https://manager.example.test" },
      {
        params: { account_id: "12" },
        headers: { "X-S3-Workspace": "manager-browser" },
      },
    );
  });
});
