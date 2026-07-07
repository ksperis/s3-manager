import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import BucketFeatureJsonExample from "../BucketFeatureJsonExample";

describe("BucketFeatureJsonExample", () => {
  it("uses shared controls for example actions", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onUseExample = vi.fn();

    render(
      <BucketFeatureJsonExample
        show={false}
        onToggle={onToggle}
        example='{"Rules":[]}'
        onUseExample={onUseExample}
        helperText={<span>Paste a valid JSON payload.</span>}
      />,
    );

    const toggleButton = screen.getByRole("button", { name: "Show example" });
    const useButton = screen.getByRole("button", { name: "Use example" });

    expect(toggleButton).toHaveClass("ui-button-base");
    expect(useButton).toHaveClass("ui-button-base");
    expect(screen.getByText("Paste a valid JSON payload.")).toBeInTheDocument();
    expect(screen.queryByText('{"Rules":[]}')).not.toBeInTheDocument();

    await user.click(toggleButton);
    await user.click(useButton);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onUseExample).toHaveBeenCalledTimes(1);
  });

  it("keeps both actions disabled when editing is disabled", () => {
    const onToggle = vi.fn();
    const onUseExample = vi.fn();

    render(
      <BucketFeatureJsonExample
        show
        onToggle={onToggle}
        example='{"Rules":[]}'
        onUseExample={onUseExample}
        disabled
      />,
    );

    expect(screen.getByRole("button", { name: "Hide example" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use example" })).toBeDisabled();
    expect(screen.getByText('{"Rules":[]}')).toBeInTheDocument();
  });
});
