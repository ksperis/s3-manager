/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GroupAvatar from "../GroupAvatar";

const mocks = vi.hoisted(() => ({
  fetchImage: vi.fn(),
  createObjectURL: vi.fn(),
}));

vi.mock("../../api/avatarImages", () => ({
  fetchAuthenticatedAvatarImage: (...args: unknown[]) => mocks.fetchImage(...args),
}));

describe("GroupAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createObjectURL.mockReturnValue("blob:group-avatar");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mocks.createObjectURL });
  });

  it("renders a distinguishable rounded group pictogram", () => {
    render(
      <GroupAvatar
        name="Storage Operators"
        avatar={{ source: "preset", initials: "SO", icon: "shield" }}
      />,
    );

    const avatar = screen.getByTitle("Storage Operators");
    expect(avatar).toHaveClass("rounded-lg");
    expect(avatar.querySelector("svg")).toBeInTheDocument();
  });

  it("loads an uploaded group image through the authenticated API", async () => {
    mocks.fetchImage.mockResolvedValue(new Blob(["avatar"], { type: "image/png" }));
    render(
      <GroupAvatar
        name="Data Team"
        avatar={{ source: "uploaded", initials: "DT", url: "/admin/groups/7/avatar?v=2" }}
      />,
    );

    await waitFor(() => expect(mocks.fetchImage).toHaveBeenCalledWith("/admin/groups/7/avatar?v=2"));
    expect(await screen.findByRole("presentation")).toHaveAttribute("src", "blob:group-avatar");
  });
});
