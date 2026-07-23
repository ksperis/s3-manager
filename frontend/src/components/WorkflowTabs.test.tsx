/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import WorkflowTabs from "./WorkflowTabs";

function EditorTabs() {
  const [activeTab, setActiveTab] = useState<"general" | "access">("general");
  return (
    <WorkflowTabs
      activeTab={activeTab}
      onTabChange={setActiveTab}
      ariaLabel="Editor sections"
      idPrefix="entity-editor"
      tabs={[
        { id: "general", label: "General" },
        { id: "hidden", label: "Hidden", visible: false },
        { id: "access", label: "Access" },
      ]}
    >
      {activeTab === "general" ? "General settings" : "Access settings"}
    </WorkflowTabs>
  );
}

describe("WorkflowTabs", () => {
  it("shares the line treatment and an accessible tab panel", () => {
    render(<EditorTabs />);

    const tablist = screen.getByRole("tablist", { name: "Editor sections" });
    expect(tablist.parentElement).toHaveClass("border-b", "pb-3");
    expect(screen.queryByRole("tab", { name: "Hidden" })).not.toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("General settings");

    fireEvent.click(screen.getByRole("tab", { name: "Access" }));

    expect(screen.getByRole("tabpanel")).toHaveTextContent("Access settings");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "entity-editor-tab-access",
    );
  });
});
