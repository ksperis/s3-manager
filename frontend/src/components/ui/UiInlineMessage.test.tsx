import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import UiInlineMessage from "./UiInlineMessage";

describe("UiInlineMessage", () => {
  it("renders compact inline messages with tone classes", () => {
    render(<UiInlineMessage tone="error">Unable to load bucket logging.</UiInlineMessage>);

    const message = screen.getByText("Unable to load bucket logging.");
    expect(message).toHaveClass("ui-caption");
    expect(message).toHaveClass("border-rose-200");
    expect(message).toHaveClass("text-rose-700");
  });

  it("supports success and custom classes", () => {
    render(
      <UiInlineMessage tone="success" className="mt-2">
        Saved.
      </UiInlineMessage>
    );

    const message = screen.getByText("Saved.");
    expect(message).toHaveClass("border-emerald-200");
    expect(message).toHaveClass("mt-2");
  });

  it("renders nothing without content", () => {
    const { container } = render(<UiInlineMessage>{null}</UiInlineMessage>);
    expect(container).toBeEmptyDOMElement();
  });
});
