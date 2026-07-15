/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UserAvatar, { UserAvatarStack } from "../UserAvatar";

const mocks = vi.hoisted(() => ({
  fetchUserAvatarImage: vi.fn(),
  createObjectURL: vi.fn(),
}));

vi.mock("../../api/avatarImages", () => ({
  fetchAuthenticatedAvatarImage: (...args: unknown[]) => mocks.fetchUserAvatarImage(...args),
}));

describe("UserAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createObjectURL.mockReturnValue("blob:profile-avatar");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mocks.createObjectURL,
    });
  });

  it("shows the full name on hover and falls back to initials when a remote image fails", () => {
    render(
      <UserAvatar
        name="Alice Example"
        email="alice@example.com"
        avatar={{
          preference: "auto",
          source: "provider",
          url: "https://idp.example.test/alice.png",
          initials: "AE",
        }}
      />,
    );

    const avatar = screen.getByTitle("Alice Example");
    const image = within(avatar).getByRole("presentation");
    expect(image).toHaveAttribute("src", "https://idp.example.test/alice.png");

    fireEvent.error(image);

    expect(avatar).toHaveTextContent("AE");
  });

  it("loads uploaded images through the authenticated API", async () => {
    mocks.fetchUserAvatarImage.mockResolvedValue(new Blob(["avatar"], { type: "image/png" }));

    render(
      <UserAvatar
        name="Bob Upload"
        email="bob@example.com"
        avatar={{
          preference: "uploaded",
          source: "uploaded",
          url: "/users/42/avatar?v=123",
          initials: "BU",
        }}
      />,
    );

    await waitFor(() => {
      expect(mocks.fetchUserAvatarImage).toHaveBeenCalledWith("/users/42/avatar?v=123");
    });
    expect(await screen.findByRole("presentation")).toHaveAttribute(
      "src",
      "blob:profile-avatar",
    );
  });

  it("limits collaborator previews and exposes the remaining count", () => {
    render(
      <UserAvatarStack
        people={[
          { user_id: 1, email: "alice@example.com", display_name: "Alice Example" },
          { user_id: 2, email: "bob@example.com", display_name: "Bob Example" },
          { user_id: 3, email: "carol@example.com", display_name: "Carol Example" },
        ]}
        totalCount={7}
        maxVisible={2}
      />,
    );

    expect(screen.getByTitle("Alice Example")).toBeInTheDocument();
    expect(screen.getByTitle("Bob Example")).toBeInTheDocument();
    expect(screen.queryByTitle("Carol Example")).not.toBeInTheDocument();
    expect(screen.getByTitle("5 more collaborators")).toHaveTextContent("+5");
  });
});
