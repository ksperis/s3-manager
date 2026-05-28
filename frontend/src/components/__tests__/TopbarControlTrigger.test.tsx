import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TopbarControlTrigger from "../TopbarControlTrigger";

describe("TopbarControlTrigger", () => {
  it("renders the label and value in icon-label mode with the shared control shell", () => {
    render(
      <TopbarControlTrigger
        mode="icon_label"
        label="Account"
        value="Account_test (s3-z1)"
        ariaLabel="Select account"
        icon={<span aria-hidden="true">A</span>}
        onClick={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "Select account" });
    expect(trigger).toHaveClass("h-10", "rounded-lg", "border-slate-200");
    expect(screen.getByText("Account")).toHaveClass("uppercase");
    expect(screen.getByText("Account_test (s3-z1)")).toBeInTheDocument();
  });

  it("keeps icon-only controls square and accessible", () => {
    render(
      <TopbarControlTrigger
        mode="icon"
        label="Endpoint"
        value="s3-z1"
        ariaLabel="Select endpoint"
        icon={<span aria-hidden="true">E</span>}
      />
    );

    const trigger = screen.getByRole("button", { name: "Select endpoint" });
    expect(trigger).toHaveClass("h-10", "w-10");
    expect(screen.getByText("s3-z1")).toHaveClass("sr-only");
  });
});
