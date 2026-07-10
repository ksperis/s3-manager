/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import WorkflowPage, { WorkflowActions, WorkflowSection, workflowPageHostClass } from "../WorkflowPage";

describe("WorkflowPage", () => {
  it("renders page hierarchy and a predictable return action", () => {
    const onBack = vi.fn();

    render(
      <MemoryRouter>
        <WorkflowPage
          title="Purge buckets"
          description="Follow the operation through completion."
          breadcrumbs={[{ label: "Storage Ops", to: "/storage-ops" }, { label: "Purge" }]}
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
    expect(screen.getByRole("heading", { name: "Targets" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to buckets" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("marks a host when its list should yield to a workflow page", () => {
    expect(workflowPageHostClass(false, "space-y-6")).toBe("space-y-6");
    expect(workflowPageHostClass(true, "space-y-6")).toContain("workflow-page-host--active");
  });
});
