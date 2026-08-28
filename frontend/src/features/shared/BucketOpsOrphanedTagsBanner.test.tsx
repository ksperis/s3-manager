/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsOrphanedTagsBanner, {
  type OrphanedTagBucketDetail,
} from "./BucketOpsOrphanedTagsBanner";

const orphan: OrphanedTagBucketDetail = {
  key: "archive",
  endpointId: 7,
  name: "archive",
  tenant: "tenant-a",
  tags: ["critical", "retained"],
};

describe("BucketOpsOrphanedTagsBanner", () => {
  it("does not render without orphaned tag assignments", () => {
    const { container } = render(
      <BucketOpsOrphanedTagsBanner details={[]} onClear={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders recorded identity and tag details and delegates cleanup", () => {
    const onClear = vi.fn();
    render(
      <BucketOpsOrphanedTagsBanner details={[orphan]} onClear={onClear} />,
    );

    expect(
      screen.getByText(
        "UI tags exist for 1 bucket no longer present on its recorded endpoint.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("archive", { selector: "p" })).toHaveTextContent(
      "archive(tenant: tenant-a)(endpoint: 7)",
    );
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("retained")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove tags" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("uses plural wording and reports assignments without tag values", () => {
    render(
      <BucketOpsOrphanedTagsBanner
        details={[
          orphan,
          { ...orphan, key: "empty", name: "empty", tenant: null, tags: [] },
        ]}
        onClear={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "UI tags exist for 2 buckets no longer present on their recorded endpoints.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No tag values found.")).toBeInTheDocument();
  });
});
