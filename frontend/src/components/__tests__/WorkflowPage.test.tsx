/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import WorkflowPage, {
  WorkflowActions,
  WorkflowMetadata,
  WorkflowSection,
  workflowPageHostClass,
} from "../WorkflowPage";

describe("WorkflowPage", () => {
  it("renders page hierarchy and a predictable return action", () => {
    const onBack = vi.fn();

    render(
      <MemoryRouter>
        <WorkflowPage
          title="Purge buckets"
          description="Follow the operation through completion."
          breadcrumbs={[
            { label: "Storage Ops", to: "/storage-ops" },
            { label: "Buckets", to: "/storage-ops/buckets" },
            { label: "Purge" },
          ]}
          onBack={onBack}
          backLabel="Back to buckets"
        >
          <WorkflowSection title="Targets" description="Two buckets selected.">
            <p>bucket-a</p>
          </WorkflowSection>
          <WorkflowActions>
            <button type="button">Run</button>
          </WorkflowActions>
        </WorkflowPage>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Purge buckets" })).toBeInTheDocument();
    expect(screen.getByText("Follow the operation through completion.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Storage Ops" })).toHaveAttribute("href", "/storage-ops");
    expect(screen.getByRole("link", { name: "Buckets" })).toHaveAttribute("href", "/storage-ops/buckets");
    expect(screen.getByRole("heading", { name: "Targets" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Buckets" }));
    expect(onBack).toHaveBeenCalledOnce();
    onBack.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Back to buckets" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("marks a host when its list should yield to a workflow page", () => {
    expect(workflowPageHostClass(false, "space-y-6")).toBe("space-y-6");
    const activeClassName = workflowPageHostClass(true, "space-y-6");
    expect(activeClassName).toContain("workflow-page-host--active");
    expect(activeClassName).toContain("[&>.workflow-page]:!mt-0");
  });

  it("keeps the header and content on the same bounded page axis", () => {
    const { container } = render(
      <WorkflowPage
        title="Edit user"
        metaContent={<WorkflowMetadata items={[{ label: "Identity", value: "jane@example.com" }]} />}
        width="wide"
        contentVariant="plain"
      >
        <p>Configuration</p>
      </WorkflowPage>
    );

    const workflow = container.querySelector(".workflow-page");
    expect(workflow).toHaveAttribute("data-workflow-width", "wide");
    expect(workflow).toHaveClass("w-full", "max-w-7xl");
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("Configuration").parentElement).not.toHaveClass("mx-auto");
  });
});
