import { render, screen } from "@testing-library/react";

import UiButton from "./UiButton";
import UiIconButton from "./UiIconButton";

describe("UiButton", () => {
  it("applies shared size and variant classes", () => {
    render(
      <UiButton variant="secondary" size="sm">
        Save
      </UiButton>
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("ui-button-secondary", "h-8");
  });

  it("disables the button while loading", () => {
    render(<UiButton loading>Saving</UiButton>);

    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
  });
});

describe("UiIconButton", () => {
  it("requires an accessible label for icon-only actions", () => {
    render(<UiIconButton label="Refresh list" icon="R" size="compact" />);

    expect(screen.getByRole("button", { name: "Refresh list" })).toHaveClass("h-6", "w-6");
  });
});
