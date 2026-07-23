/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import PageTabs, { PageTabPanel } from "./PageTabs";

function SemanticTabs() {
  const [activeTab, setActiveTab] = useState("connection");
  return (
    <>
      <PageTabs
        tabs={[
          { id: "connection", label: "Connection" },
          { id: "disabled", label: "Disabled", disabled: true },
          { id: "credentials", label: "Credentials" },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel="Endpoint sections"
        idPrefix="endpoint-editor"
        variant="bar"
      />
      <PageTabPanel idPrefix="endpoint-editor" tabId={activeTab}>
        {activeTab === "connection" ? "Connection panel" : "Credentials panel"}
      </PageTabPanel>
    </>
  );
}

describe("PageTabs", () => {
  it("links semantic tabs to their panels and supports arrow-key navigation", () => {
    render(<SemanticTabs />);

    const connectionTab = screen.getByRole("tab", { name: "Connection" });
    expect(connectionTab).toHaveAttribute("id", "endpoint-editor-tab-connection");
    expect(connectionTab).toHaveAttribute("aria-controls", "endpoint-editor-panel-connection");
    expect(connectionTab).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "endpoint-editor-tab-connection",
    );

    fireEvent.keyDown(connectionTab, { key: "ArrowRight" });

    const credentialsTab = screen.getByRole("tab", { name: "Credentials" });
    expect(credentialsTab).toHaveAttribute("aria-selected", "true");
    expect(credentialsTab).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "endpoint-editor-panel-credentials",
    );
    expect(screen.getByRole("tab", { name: "Disabled" })).toBeDisabled();
  });

  it("renders content below bar tabs without adding a card frame", () => {
    render(
      <PageTabs
        tabs={[
          { id: "general", label: "General", content: <p>General settings</p> },
          { id: "access", label: "Access", content: <p>Access settings</p> },
        ]}
        activeTab="general"
        onChange={() => undefined}
        ariaLabel="Editor sections"
        idPrefix="editor"
        variant="bar"
      />
    );

    expect(screen.getByRole("tabpanel")).toHaveTextContent("General settings");
    expect(screen.getByRole("tabpanel")).toHaveClass("mt-4");
    expect(screen.getByRole("tabpanel").parentElement).not.toHaveClass("ui-surface-card");
  });

  it("owns the shared baseline for top-level page tabs", () => {
    const { container } = render(
      <PageTabs
        tabs={[{ id: "general", label: "General" }]}
        activeTab="general"
        onChange={() => undefined}
        variant="line"
      />
    );

    expect(container.firstElementChild).toHaveClass("border-b", "pb-3");
    expect(container.firstElementChild).toHaveClass("border-[color:var(--ui-border-soft)]");
    expect(screen.getByText("General").parentElement).toHaveClass("min-w-0", "flex-1", "flex-wrap");
  });
});
