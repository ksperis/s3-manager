import { render, screen } from "@testing-library/react";

import UiMeterBar from "./UiMeterBar";

describe("UiMeterBar", () => {
  it("renders quota usage with meter semantics", () => {
    render(<UiMeterBar value={42.4} label="Storage quota usage" />);

    const meter = screen.getByRole("meter", { name: "Storage quota usage" });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("aria-valuenow", "42");
  });

  it("clamps values to the meter range", () => {
    const { rerender } = render(<UiMeterBar value={130} label="Object quota usage" />);

    expect(screen.getByRole("meter", { name: "Object quota usage" })).toHaveAttribute("aria-valuenow", "100");

    rerender(<UiMeterBar value={-10} label="Object quota usage" />);

    expect(screen.getByRole("meter", { name: "Object quota usage" })).toHaveAttribute("aria-valuenow", "0");
  });
});
