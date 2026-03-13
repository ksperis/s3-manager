import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PortalBucketModal from "./PortalBucketModal";

const navigateMock = vi.fn();
const tMock = (text: { en: string }) => text.en;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    language: "en",
    t: tMock,
  }),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      browser_enabled: true,
      browser_portal_enabled: true,
    },
  }),
}));

const baseBucket = {
  name: "bucket-a",
  creation_date: "2026-03-10T10:00:00Z",
  used_bytes: 128,
  object_count: 0,
  quota_max_size_bytes: null,
  quota_max_objects: null,
};

describe("PortalBucketModal", () => {
  it("disables delete button when bucket is not empty", async () => {
    const user = userEvent.setup();
    const onDeleteBucket = vi.fn();
    render(
      <PortalBucketModal
        bucket={{ ...baseBucket, object_count: 3 }}
        accountId={1}
        onClose={() => {}}
        canDeleteBucket
        onDeleteBucket={onDeleteBucket}
      />
    );

    const deleteButton = screen.getByRole("button", { name: "Delete bucket" });
    expect(deleteButton).toBeDisabled();
    await user.click(deleteButton);
    expect(onDeleteBucket).not.toHaveBeenCalled();
  });

  it("enables delete button when bucket is empty and user can delete", async () => {
    const user = userEvent.setup();
    const onDeleteBucket = vi.fn();
    render(
      <PortalBucketModal
        bucket={{ ...baseBucket, object_count: 0 }}
        accountId={1}
        onClose={() => {}}
        canDeleteBucket
        onDeleteBucket={onDeleteBucket}
      />
    );

    const deleteButton = screen.getByRole("button", { name: "Delete bucket" });
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);
    expect(onDeleteBucket).toHaveBeenCalledTimes(1);
  });

  it("disables delete button when bucket stats are unknown", () => {
    render(
      <PortalBucketModal
        bucket={{ ...baseBucket, object_count: null }}
        accountId={1}
        onClose={() => {}}
        canDeleteBucket
        onDeleteBucket={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "Delete bucket" })).toBeDisabled();
  });

  it("disables delete button while deletion is in progress", () => {
    render(
      <PortalBucketModal
        bucket={{ ...baseBucket, object_count: 0 }}
        accountId={1}
        onClose={() => {}}
        canDeleteBucket
        deletingBucket
        onDeleteBucket={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
  });
});
