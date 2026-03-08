import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BucketFeatureCard from "../BucketFeatureCard";

describe("BucketFeatureCard", () => {
  it("renders a unified header with mode and actions", () => {
    render(
      <BucketFeatureCard
        title="Replication"
        description="Replicate objects."
        mode="hybrid"
        visualState="configured"
        actions={<button type="button">Save</button>}
        testId="feature-card"
      >
        <div>Body</div>
      </BucketFeatureCard>
    );

    expect(screen.getByText("Replication")).toBeInTheDocument();
    expect(screen.getByText("Replicate objects.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByTestId("feature-card")).toHaveAttribute("data-feature-state", "configured");
    expect(screen.getByTestId("feature-card")).toHaveAttribute("data-feature-mode", "hybrid");
  });

  it("applies unsaved visual classes for pending changes", () => {
    const { container } = render(
      <BucketFeatureCard title="CORS" description="CORS" mode="json" visualState="unsaved">
        <div>Body</div>
      </BucketFeatureCard>
    );

    expect(container.firstChild).toHaveClass("ring-amber-300/70");
  });

  it("applies neutral visual classes by default", () => {
    const { container } = render(
      <BucketFeatureCard title="Policy" description="Policy" mode="json" visualState="neutral">
        <div>Body</div>
      </BucketFeatureCard>
    );

    expect(container.firstChild).not.toHaveClass("ring-amber-300/70");
    expect(container.firstChild).not.toHaveClass("ring-emerald-200/70");
  });

  it("applies configured and disabled visual classes", () => {
    const configured = render(
      <BucketFeatureCard title="Lifecycle" description="Lifecycle" mode="hybrid" visualState="configured">
        <div>Body</div>
      </BucketFeatureCard>
    );
    expect(configured.container.firstChild).toHaveClass("ring-emerald-200/70");

    const disabled = render(
      <BucketFeatureCard title="Website" description="Website" mode="hybrid" visualState="disabled">
        <div>Body</div>
      </BucketFeatureCard>
    );
    expect(disabled.container.firstChild).toHaveClass("opacity-60");
  });
});
