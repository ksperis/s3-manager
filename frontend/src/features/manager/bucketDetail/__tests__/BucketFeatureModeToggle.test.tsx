import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import BucketFeatureModeToggle from "../BucketFeatureModeToggle";

describe("BucketFeatureModeToggle", () => {
  const options = [
    { value: "visual", label: "Visual" },
    { value: "json", label: "JSON" },
  ] as const;

  it("uses shared buttons and calls back with the selected mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <BucketFeatureModeToggle
        value="visual"
        options={[...options]}
        onChange={onChange}
      />,
    );

    const visualButton = screen.getByRole("button", { name: "Visual" });
    const jsonButton = screen.getByRole("button", { name: "JSON" });

    expect(visualButton).toHaveClass("ui-button-base", "ui-button-primary");
    expect(jsonButton).toHaveClass("ui-button-base", "ui-button-secondary");

    await user.click(jsonButton);

    expect(onChange).toHaveBeenCalledWith("json");
  });

  it("keeps all mode buttons disabled when editing is disabled", () => {
    const onChange = vi.fn();

    render(
      <BucketFeatureModeToggle
        value="json"
        options={[...options]}
        onChange={onChange}
        disabled
      />,
    );

    expect(screen.getByRole("button", { name: "Visual" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "JSON" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "JSON" })).toHaveClass(
      "ui-button-primary",
    );
  });
});
