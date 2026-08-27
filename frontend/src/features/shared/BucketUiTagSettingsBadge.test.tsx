import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UiTagBadge } from "../../components/UiTagSettings";
import BucketUiTagSettingsBadge from "./BucketUiTagSettingsBadge";

const privateTag = {
  id: 17,
  label: "Review",
  color_key: "amber",
  scope: "standard" as const,
  visibility: "private" as const,
};

describe("BucketUiTagSettingsBadge", () => {
  it("persists colors immediately and confirms visibility conversions", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(
      <BucketUiTagSettingsBadge
        tag={privateTag}
        isStorageOps={false}
        onChange={onChange}
      />
    );

    await user.click(
      screen.getByRole("button", {
        name: "Configure UI tag Review, Private",
      })
    );
    const settings = await screen.findByRole("group", {
      name: "Tag settings for Review",
    });
    await user.click(
      within(settings).getByRole("button", {
        name: "Set Review color to Blue",
      })
    );
    expect(onChange).toHaveBeenCalledWith({ color_key: "blue" });

    await user.click(within(settings).getByRole("button", { name: "Shared" }));
    expect(onChange).not.toHaveBeenCalledWith({ visibility: "shared" });
    await user.click(screen.getByRole("button", { name: "Make shared" }));
    expect(onChange).toHaveBeenCalledWith({ visibility: "shared" });
  });

  it("keeps Storage Ops visibility private and hidden", async () => {
    const user = userEvent.setup();
    render(
      <BucketUiTagSettingsBadge
        tag={privateTag}
        isStorageOps
        onChange={vi.fn()}
      />
    );

    await user.click(
      screen.getByRole("button", {
        name: "Configure UI tag Review, Private",
      })
    );
    const settings = await screen.findByRole("group", {
      name: "Tag settings for Review",
    });
    expect(within(settings).queryByText("Visibility")).not.toBeInTheDocument();
    expect(within(settings).queryByRole("button", { name: "Shared" })).not.toBeInTheDocument();
    expect(within(settings).getByRole("button", { name: "Standard" })).toBeDisabled();
  });

  it("uses dashed private and solid shared borders without visible suffixes", () => {
    const { rerender } = render(
      <UiTagBadge label="Private label" colorKey="teal" visibility="private" />
    );
    const privateBadge = screen.getByText("Private label").parentElement;
    expect(privateBadge).toHaveClass("!border-dashed");
    expect(screen.queryByText(/^Private$/)).not.toBeInTheDocument();

    rerender(
      <UiTagBadge label="Shared label" colorKey="blue" visibility="shared" />
    );
    const sharedBadge = screen.getByText("Shared label").parentElement;
    expect(sharedBadge).toHaveClass("!border-solid");
    expect(screen.queryByText(/^Shared$/)).not.toBeInTheDocument();
  });
});
