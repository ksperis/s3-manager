import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import UiDetails from "./UiDetails";

describe("UiDetails", () => {
  it("opens initially from defaultOpen and keeps user toggles across rerenders", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <UiDetails defaultOpen className="rounded">
        <summary>Section</summary>
        <div>Body</div>
      </UiDetails>
    );

    const details = screen.getByText("Body").closest("details");
    expect(details).toHaveAttribute("open");

    await user.click(screen.getByText("Section"));
    expect(details).not.toHaveAttribute("open");

    rerender(
      <UiDetails defaultOpen className="rounded">
        <summary>Section</summary>
        <div>Body</div>
      </UiDetails>
    );

    expect(details).not.toHaveAttribute("open");
  });

  it("opens when defaultOpen becomes true after an update", () => {
    const { rerender } = render(
      <UiDetails>
        <summary>Section</summary>
        <div>Body</div>
      </UiDetails>
    );

    const details = screen.getByText("Body").closest("details");
    expect(details).not.toHaveAttribute("open");

    rerender(
      <UiDetails defaultOpen>
        <summary>Section</summary>
        <div>Body</div>
      </UiDetails>
    );

    expect(details).toHaveAttribute("open");
  });
});
