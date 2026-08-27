import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UiTagBadge } from "../UiTagSettings";

describe("UiTagBadge filter states", () => {
  it("renders available tags as ghost actions with an accessible add label", () => {
    render(
      <UiTagBadge
        label="Review"
        colorKey="pink"
        visibility="private"
        selectionState="available"
        onClick={vi.fn()}
        ariaLabel="Add UI tag filter Review, Private"
      />
    );

    const action = screen.getByRole("button", {
      name: "Add UI tag filter Review, Private",
    });
    const badge = action.parentElement as HTMLElement;
    expect(badge).toHaveAttribute("data-tag-selection-state", "available");
    expect(badge).toHaveClass(
      "!bg-transparent",
      "border-pink-200",
      "text-pink-700",
      "shadow-none",
      "hover:!bg-slate-50",
      "focus-within:!bg-slate-50",
      "dark:hover:!bg-slate-800/70",
      "!border-dashed"
    );
    expect(within(badge).getByText("+")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders selected tags with their palette, check, ring, and remove action", () => {
    render(
      <UiTagBadge
        label="Review"
        colorKey="blue"
        visibility="shared"
        selectionState="selected"
        ariaLabel="Selected UI tag filter Review, Shared"
        onRemove={vi.fn()}
        removeAriaLabel="Remove UI tag filter Review, Shared"
      />
    );

    const selectedLabel = screen.getByLabelText(
      "Selected UI tag filter Review, Shared"
    );
    const badge = selectedLabel.parentElement as HTMLElement;
    expect(badge).toHaveAttribute("data-tag-selection-state", "selected");
    expect(badge).toHaveClass(
      "bg-blue-50",
      "ring-2",
      "ring-primary/50",
      "shadow-md",
      "!border-solid"
    );
    expect(within(badge).getByText("✓")).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("button", {
        name: "Remove UI tag filter Review, Shared",
      })
    ).toBeInTheDocument();
  });
});
