import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAdminOpsModal from "./CephAdminAdminOpsModal";

const deleteAccountMock = vi.fn();
const deleteUserMock = vi.fn();
const deleteBucketMock = vi.fn();
const unlinkBucketMock = vi.fn();
const linkBucketMock = vi.fn();
const checkIndexMock = vi.fn();
const listUsersMock = vi.fn();
const listAccountsMock = vi.fn();

vi.mock("../../api/cephAdminAdminOps", () => ({
  deleteCephAdminAccount: (...args: unknown[]) => deleteAccountMock(...args),
  deleteCephAdminUser: (...args: unknown[]) => deleteUserMock(...args),
  deleteCephAdminBucket: (...args: unknown[]) => deleteBucketMock(...args),
  unlinkCephAdminBucket: (...args: unknown[]) => unlinkBucketMock(...args),
  linkCephAdminBucket: (...args: unknown[]) => linkBucketMock(...args),
  checkCephAdminBucketIndex: (...args: unknown[]) => checkIndexMock(...args),
}));

vi.mock("../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdmin")>("../../api/cephAdmin");
  return {
    ...actual,
    listCephAdminUsers: (...args: unknown[]) => listUsersMock(...args),
  };
});

vi.mock("../../api/cephAdminAccounts", () => ({
  listCephAdminAccounts: (...args: unknown[]) => listAccountsMock(...args),
}));

const successResult = {
  operation: "test",
  success: true,
  rgw_status_code: 204,
  rgw_error_code: null,
  message: "Completed by RGW",
  result: null,
};

describe("CephAdminAdminOpsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteAccountMock.mockResolvedValue(successResult);
    deleteUserMock.mockResolvedValue(successResult);
    deleteBucketMock.mockResolvedValue(successResult);
    unlinkBucketMock.mockResolvedValue(successResult);
    linkBucketMock.mockResolvedValue(successResult);
    checkIndexMock.mockResolvedValue({ ...successResult, rgw_status_code: 200, result: { existing_header: {} } });
    listUsersMock.mockResolvedValue({
      items: [{ uid: "alice", tenant: "tenant-a", full_name: "Alice" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
    listAccountsMock.mockResolvedValue({
      items: [{ account_id: "RGW12345678901234567", account_name: "Analytics" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
  });

  it("requires the exact account phrase and keeps the RGW result visible", async () => {
    const onSuccess = vi.fn();
    render(
      <CephAdminAdminOpsModal
        endpointId={7}
        endpointName="Lab"
        action={{ kind: "delete-account", account: { account_id: "RGW12345678901234567" } }}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    );

    expect(screen.getByText("Lab")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run operation" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirmation phrase"), {
      target: { value: "DELETE ACCOUNT RGW12345678901234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run operation" }));

    await waitFor(() => expect(deleteAccountMock).toHaveBeenCalledWith(7, "RGW12345678901234567", "DELETE ACCOUNT RGW12345678901234567"));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByText("RGW HTTP 204")).toBeInTheDocument();
    expect(screen.getByText("No response body.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("changes the user phrase and payload when purge-data is enabled", async () => {
    render(
      <CephAdminAdminOpsModal
        endpointId={7}
        action={{ kind: "delete-user", user: { uid: "alice", tenant: "tenant-a" } }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Purge owned data/ }));
    expect(screen.getByText("PURGE USER tenant-a$alice")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Confirmation phrase"), {
      target: { value: "PURGE USER tenant-a$alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run operation" }));

    await waitFor(() =>
      expect(deleteUserMock).toHaveBeenCalledWith(
        7,
        "alice",
        { confirmation: "PURGE USER tenant-a$alice", purge_data: true },
        "tenant-a"
      )
    );
  });

  it("enforces purge-objects before bypass-gc and updates the bucket phrase", () => {
    render(
      <CephAdminAdminOpsModal
        endpointId={7}
        action={{ kind: "delete-bucket", bucket: { name: "bucket-a", tenant: "tenant-a" } }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Advanced options"));
    const bypass = screen.getByRole("checkbox", { name: /Bypass garbage collection/ });
    expect(bypass).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Purge objects and versions/ }));
    expect(bypass).toBeEnabled();
    fireEvent.click(bypass);
    expect(screen.getByText("PURGE AND DELETE BUCKET tenant-a/bucket-a")).toBeInTheDocument();
  });

  it("confirms unlink with the qualified bucket name", async () => {
    render(
      <CephAdminAdminOpsModal
        endpointId={7}
        action={{ kind: "unlink-bucket", bucket: { name: "bucket-a", tenant: "tenant-a" } }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Confirmation phrase"), {
      target: { value: "UNLINK BUCKET tenant-a/bucket-a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run operation" }));

    await waitFor(() =>
      expect(unlinkBucketMock).toHaveBeenCalledWith(7, "bucket-a", "UNLINK BUCKET tenant-a/bucket-a", "tenant-a")
    );
  });

  it("uses simple confirmation for a read-only index check and couples check-objects to fix", async () => {
    render(
      <CephAdminAdminOpsModal
        endpointId={7}
        action={{ kind: "index-check", bucket: { name: "bucket-a" } }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("Confirmation phrase")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run check" }));
    await waitFor(() =>
      expect(checkIndexMock).toHaveBeenCalledWith(
        7,
        "bucket-a",
        { confirmation: undefined, fix: false, check_objects: false },
        undefined
      )
    );

    const checkObjects = screen.getByRole("checkbox", { name: /Check object state/ });
    expect(checkObjects).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Fix detected index issues/ }));
    expect(checkObjects).toBeEnabled();
    fireEvent.click(checkObjects);
    expect(screen.getByText("FIX BUCKET INDEX bucket-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Fix detected index issues/ }));
    expect(checkObjects).not.toBeChecked();
    expect(checkObjects).toBeDisabled();
  });

  it("selects an existing RGW User for link and never accepts a free target id", async () => {
    render(
      <CephAdminAdminOpsModal
        endpointId={7}
        endpointName="Lab"
        action={{ kind: "link-bucket", bucket: { name: "bucket-a" } }}
        canAccounts
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    expect(screen.getByText(/does not rewrite object ACLs/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Alice · tenant-a$alice" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Alice · tenant-a$alice" }));
    expect(screen.getByText("LINK BUCKET bucket-a TO tenant-a$alice")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Confirmation phrase"), {
      target: { value: "LINK BUCKET bucket-a TO tenant-a$alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run operation" }));

    await waitFor(() =>
      expect(linkBucketMock).toHaveBeenCalledWith(
        7,
        "bucket-a",
        {
          confirmation: "LINK BUCKET bucket-a TO tenant-a$alice",
          target_type: "user",
          target_id: "tenant-a$alice",
        },
        undefined
      )
    );
  });

  it("searches and selects an existing RGW Account for link", async () => {
    render(
      <CephAdminAdminOpsModal
        endpointId={7}
        action={{ kind: "link-bucket", bucket: { name: "bucket-a" } }}
        canAccounts
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "RGW Accounts" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Analytics · RGW12345678901234567" })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "Analytics · RGW12345678901234567" }));
    expect(screen.getByText("LINK BUCKET bucket-a TO RGW12345678901234567")).toBeInTheDocument();
  });

  it("shows structured RGW failures and leaves retry available", async () => {
    deleteAccountMock.mockRejectedValue({
      response: {
        data: {
          operation: "delete_account",
          success: false,
          rgw_status_code: 409,
          rgw_error_code: "AccountNotEmpty",
          message: "Account still owns resources",
          result: { Code: "AccountNotEmpty" },
        },
      },
    });
    render(
      <CephAdminAdminOpsModal
        endpointId={7}
        action={{ kind: "delete-account", account: { account_id: "RGW12345678901234567" } }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Confirmation phrase"), {
      target: { value: "DELETE ACCOUNT RGW12345678901234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run operation" }));

    await waitFor(() => expect(screen.getByText("RGW HTTP 409")).toBeInTheDocument());
    expect(screen.getByText("Ceph code AccountNotEmpty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
});
