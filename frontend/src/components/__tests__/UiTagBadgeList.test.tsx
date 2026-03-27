import { render, screen } from "@testing-library/react";
import UiTagBadgeList from "../UiTagBadgeList";

describe("UiTagBadgeList", () => {
  it("renders the selected tag palette classes without neutral tone classes", () => {
    render(
      <UiTagBadgeList
        items={[
          {
            key: "amber-tag",
            label: "gold",
            color_key: "amber",
          },
        ]}
      />
    );

    const badge = screen.getByText("gold").parentElement;
    expect(badge).toHaveClass("bg-amber-50");
    expect(badge).toHaveClass("border-amber-200");
    expect(badge).not.toHaveClass("bg-slate-50");
    expect(badge).not.toHaveClass("border-slate-200");
  });
});
