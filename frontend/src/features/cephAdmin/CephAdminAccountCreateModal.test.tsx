import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAccountCreateModal from "./CephAdminAccountCreateModal";

const createCephAdminAccountMock = vi.fn();

vi.mock("../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdmin")>("../../api/cephAdmin");
  return {
    ...actual,
    createCephAdminAccount: (...args: unknown[]) => createCephAdminAccountMock(...args),
  };
});

describe("CephAdminAccountCreateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCephAdminAccountMock.mockResolvedValue({
      account: {
        account_id: "RGW000000000000001",
        account_name: "analytics",
      },
    });
  });

  it("uses shared form controls and submits normalized quota fields", async () => {
    const onCreated = vi.fn();
    render(<CephAdminAccountCreateModal endpointId={7} onClose={vi.fn()} onCreated={onCreated} />);

    const dialog = screen.getByRole("heading", { name: "Create account" }).closest(".workflow-page");
    if (!dialog) {
      throw new Error("Create account workflow page not found");
    }
    expect(within(dialog).getByLabelText("Account name *")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Email")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Max access keys")).toHaveClass("ui-control");

    const accountQuotaSection = within(dialog).getByText("Account quota").closest("section");
    const bucketQuotaSection = within(dialog).getByText("Bucket quota").closest("section");
    if (!accountQuotaSection || !bucketQuotaSection) {
      throw new Error("Quota sections not found");
    }

    expect(within(accountQuotaSection).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(accountQuotaSection).getByLabelText("Unit")).toHaveClass("ui-control");
    expect(within(accountQuotaSection).getByLabelText("Object quota")).toHaveClass("ui-control");

    fireEvent.change(within(dialog).getByLabelText("Account name *"), { target: { value: "analytics" } });
    fireEvent.change(within(dialog).getByLabelText("Max buckets"), { target: { value: "12" } });
    fireEvent.click(within(accountQuotaSection).getByRole("checkbox", { name: "Enable account quota" }));
    fireEvent.change(within(accountQuotaSection).getByLabelText("Storage quota"), { target: { value: "2" } });
    fireEvent.change(within(accountQuotaSection).getByLabelText("Object quota"), { target: { value: "1000" } });
    fireEvent.click(within(bucketQuotaSection).getByRole("checkbox", { name: "Enable bucket quota" }));
    fireEvent.change(within(bucketQuotaSection).getByLabelText("Storage quota"), { target: { value: "512" } });
    fireEvent.change(within(bucketQuotaSection).getByLabelText("Unit"), { target: { value: "MiB" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(createCephAdminAccountMock).toHaveBeenCalled();
    });

    expect(createCephAdminAccountMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        account_name: "analytics",
        max_buckets: 12,
        quota_enabled: true,
        quota_max_size_bytes: 2 * 1024 ** 3,
        quota_max_objects: 1000,
        bucket_quota_enabled: true,
        bucket_quota_max_size_bytes: 512 * 1024 ** 2,
      })
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ account_id: "RGW000000000000001" }));
  });
});
