/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StorageSpaceIcon from "../StorageSpaceIcon";

const mocks = vi.hoisted(() => ({
  fetchImage: vi.fn(),
  createObjectURL: vi.fn(),
}));

vi.mock("../../api/avatarImages", () => ({
  fetchAuthenticatedAvatarImage: (...args: unknown[]) => mocks.fetchImage(...args),
}));

describe("StorageSpaceIcon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createObjectURL.mockReturnValue("blob:storage-space-icon");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mocks.createObjectURL,
    });
  });

  it("renders the selected pictogram", () => {
    render(
      <StorageSpaceIcon
        name="Research data"
        icon={{ source: "preset", preset: "archive" }}
      />,
    );

    expect(screen.getByRole("img", { name: "Research data icon" })).toHaveAttribute(
      "data-storage-space-icon-preset",
      "archive",
    );
  });

  it("loads a custom image through the authenticated API", async () => {
    mocks.fetchImage.mockResolvedValue(new Blob(["icon"], { type: "image/png" }));
    render(
      <StorageSpaceIcon
        name="Research data"
        icon={{
          source: "uploaded",
          url: "/portal/storage-spaces/research-data/icon/image?account_id=4&v=2",
        }}
      />,
    );

    await waitFor(() => {
      expect(mocks.fetchImage).toHaveBeenCalledWith(
        "/portal/storage-spaces/research-data/icon/image?account_id=4&v=2",
      );
    });
    expect(await screen.findByRole("presentation")).toHaveAttribute(
      "src",
      "blob:storage-space-icon",
    );
  });
});
