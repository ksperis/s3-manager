import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { browserBucketDetails } from "../../api/bucketDetails";
import BrowserBucketDetailsContent from "./BrowserBucketDetailsContent";

vi.mock("../../api/bucketDetails", () => ({
  browserBucketDetails: {
    getBucketStats: vi.fn(),
    getBucketProperties: vi.fn(),
    getBucketPolicy: vi.fn(),
    getBucketLogging: vi.fn(),
    getBucketWebsite: vi.fn(),
  },
}));

const api = vi.mocked(browserBucketDetails);

function resolveDetails() {
  api.getBucketStats.mockResolvedValue({
    name: "documents",
    owner: "owner-1",
    creation_date: "2026-09-03T10:00:00Z",
    used_bytes: 1024,
    object_count: 3,
    quota_max_size_bytes: 2048,
    quota_max_objects: 10,
  });
  api.getBucketProperties.mockResolvedValue({
    versioning_status: "Enabled",
    object_lock_enabled: false,
    public_access_block: {
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: true,
    },
    lifecycle_rules: [],
    cors_rules: [{}],
  });
  api.getBucketPolicy.mockResolvedValue({ policy: null });
  api.getBucketLogging.mockResolvedValue({ enabled: false });
  api.getBucketWebsite.mockResolvedValue({ index_document: "index.html" });
}

describe("BrowserBucketDetailsContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDetails();
  });

  it("shows a read-only overview and effective feature states", async () => {
    render(
      <BrowserBucketDetailsContent
        accountId="account-1"
        bucketName="documents"
        includeStaticWebsite
        includeUsage
      />,
    );

    expect(await screen.findByText("owner-1")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Versioning")).toBeInTheDocument();
    expect(screen.getAllByText("Enabled")).not.toHaveLength(0);
    expect(screen.getByText("Static website")).toBeInTheDocument();
    expect(api.getBucketStats).toHaveBeenCalledWith(
      "account-1",
      "documents",
      { with_stats: true },
    );
  });

  it("keeps partial details useful and refreshable", async () => {
    const user = userEvent.setup();
    api.getBucketPolicy.mockRejectedValueOnce(new Error("Forbidden"));

    render(
      <BrowserBucketDetailsContent
        accountId="account-1"
        bucketName="documents"
        includeStaticWebsite={false}
        includeUsage={false}
      />,
    );

    expect(
      await screen.findByText(
        "Some bucket information is unavailable for this connection.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Bucket policy")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.getBucketStats).toHaveBeenCalledTimes(2));
  });
});
