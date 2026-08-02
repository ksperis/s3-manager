/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BrowserWorkspaceSidebar from "./BrowserWorkspaceSidebar";

describe("BrowserWorkspaceSidebar", () => {
  it("renders the Portal Storage Space descriptor instead of the generic bucket icon", () => {
    render(
      <BrowserWorkspaceSidebar
        compact={false}
        variant="desktop"
        isPortalContext
        rows={[
          {
            bucket: {
              name: "research-data",
              display_name: "Research data",
              icon: { source: "preset", preset: "media" },
            },
            access: { status: "available", detail: null },
          },
        ]}
        activeBucketName="research-data"
        bucketFilter=""
        loadingBuckets={false}
        bucketError={null}
        bucketManagementEnabled={false}
        canLoadMore={false}
        bucketMenuLoadingMore={false}
        bucketMenuTotal={1}
        bucketTotalCount={1}
        usageSummary={null}
        usageLoading={false}
        usageError={null}
        closeMobile={vi.fn()}
        onBucketFilterChange={vi.fn()}
        onRetryBuckets={vi.fn()}
        onCreateBucket={vi.fn()}
        onSelectBucket={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /Research data/ });
    expect(row.querySelector('[data-storage-space-icon-preset="media"]')).toHaveClass("h-6", "w-6");
  });
});
