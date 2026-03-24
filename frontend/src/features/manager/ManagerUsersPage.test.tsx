import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerUsersPage from "./ManagerUsersPage";

const useS3AccountContextMock = vi.fn();
const listIamUsersMock = vi.fn();
const listIamGroupsMock = vi.fn();
const listIamPoliciesMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    listIamUsers: (...args: unknown[]) => listIamUsersMock(...args),
    createIamUser: vi.fn(),
    deleteIamUser: vi.fn(),
  };
});

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    listIamGroups: (...args: unknown[]) => listIamGroupsMock(...args),
  };
});

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    listIamPolicies: (...args: unknown[]) => listIamPoliciesMock(...args),
  };
});

describe("ManagerUsersPage", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listIamUsersMock.mockReset();
    listIamGroupsMock.mockReset();
    listIamPoliciesMock.mockReset();
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "s3u-1",
          kind: "legacy_user",
          display_name: "Legacy user",
          endpoint_name: "Default",
        },
      ],
      selectedS3AccountId: "s3u-1",
      selectedS3AccountType: "s3_user",
      accountIdForApi: "s3u-1",
      requiresS3AccountSelection: true,
      accessMode: "default",
      iamIdentity: null,
      sessionS3AccountName: null,
    });
    listIamUsersMock.mockResolvedValue([]);
    listIamGroupsMock.mockResolvedValue([]);
    listIamPoliciesMock.mockResolvedValue([]);
  });

  it("shows an empty state without a page-level context strip for managed S3 user contexts", async () => {
    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("IAM users are unavailable for managed S3 user contexts")).toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
    expect(screen.queryByText("IAM is not available for standalone S3 users. Select an S3 Account (tenant) to continue.")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(listIamUsersMock).toHaveBeenCalledWith("s3u-1");
      expect(listIamGroupsMock).toHaveBeenCalledWith("s3u-1");
      expect(listIamPoliciesMock).toHaveBeenCalledWith("s3u-1");
    });
  });

  it("keeps saved inline policy drafts visible in the create user modal", async () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "acc-1",
          kind: "account",
          display_name: "Tenant account",
          endpoint_name: "Default",
        },
      ],
      selectedS3AccountId: "acc-1",
      selectedS3AccountType: "tenant",
      accountIdForApi: "acc-1",
      requiresS3AccountSelection: true,
      accessMode: "default",
      iamIdentity: null,
      sessionS3AccountName: null,
    });
    listIamUsersMock.mockResolvedValue([]);
    listIamGroupsMock.mockResolvedValue([]);
    listIamPoliciesMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listIamUsersMock).toHaveBeenCalledWith("acc-1");
      expect(listIamGroupsMock).toHaveBeenCalledWith("acc-1");
      expect(listIamPoliciesMock).toHaveBeenCalledWith("acc-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    fireEvent.click(screen.getByRole("button", { name: "Show inline policies" }));
    fireEvent.change(screen.getByLabelText("Inline policy name"), { target: { value: "audit-inline" } });
    fireEvent.change(screen.getByLabelText("Inline policy document"), {
      target: { value: '{ "Version": "2012-10-17", "Statement": [] }' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getByText("Saved inline policies")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /audit-inline/i })[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new inline policy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update draft" })).toBeInTheDocument();
  });
});
