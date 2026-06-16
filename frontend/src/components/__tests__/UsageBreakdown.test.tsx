import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import UsageBreakdown from "../UsageBreakdown";

describe("UsageBreakdown", () => {
  it("constrains long legend labels so metric values stay inside the card", () => {
    const longBucketName = "lab-repl-same-20260519154640-with-a-very-long-generated-bucket-name";

    render(
      <UsageBreakdown
        title="Buckets (objects)"
        metric="objects"
        items={[
          {
            id: longBucketName,
            label: longBucketName,
            usedBytes: 249_000_000,
            objectCount: 234,
          },
        ]}
      />
    );

    const label = screen.getByText(longBucketName);
    const row = label.closest(".grid");

    expect(label).toHaveAttribute("title", longBucketName);
    expect(label).toHaveClass("truncate");
    expect(row).toHaveClass("grid-cols-[minmax(0,1fr)_auto]");
    expect(screen.getAllByText("234").length).toBeGreaterThan(0);
    expect(screen.queryByText("Breakdown")).not.toBeInTheDocument();
  });
});
