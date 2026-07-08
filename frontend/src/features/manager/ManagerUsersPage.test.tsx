import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerUsersPage from "./ManagerUsersPage";

const useS3AccountContextMock = vi.fn();
const listIamUsersMock = vi.fn();
const listIamGroupsMock = vi.fn();
const listIamPoliciesMock = vi.fn();
const createIamUserMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    listIamUsers: (...args: unknown[]) => listIamUsersMock(...args),
    createIamUser: (...args: unknown[]) => createIamUserMock(...args),
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
    createIamUserMock.mockReset();
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

  it("renders IAM users with the shared responsive inventory table", async () => {
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
    listIamUsersMock.mockResolvedValue([
      {
        name: "alice",
        arn: "arn:aws:iam::acc-1:user/alice",
        groups: ["operators"],
        policies: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
        inline_policies: [],
        has_keys: true,
      },
    ]);

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name or ARN");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "missing" } });
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "alice" } });
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByText("alice").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("arn:aws:iam::acc-1:user/alice").closest("td")).toHaveAttribute("data-label", "ARN");
    expect(screen.getByText("operators").closest("td")).toHaveAttribute("data-label", "Groups");
    expect(screen.getByText("ReadOnlyAccess").closest("td")).toHaveAttribute("data-label", "Policies");
    expect(screen.getByRole("link", { name: "Keys" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
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

  it("renders a single attach policies section in the create user modal", async () => {
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

    expect(screen.getAllByText("Attach policies (optional)")).toHaveLength(1);
  });

  it("shows created access keys in the shared one-time secret panel", async () => {
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
    createIamUserMock.mockResolvedValue({
      name: "bob",
      access_key: {
        access_key_id: "AKIA-BOB",
        secret_access_key: "SECRET-BOB",
      },
    });

    render(
      <MemoryRouter>
        <ManagerUsersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listIamUsersMock).toHaveBeenCalledWith("acc-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("User name"), { target: { value: "bob" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("Key created for bob")).toBeInTheDocument();
    expect(screen.getByText("AKIA-BOB")).toHaveClass("font-mono");
    expect(screen.getByText("SECRET-BOB")).toHaveClass("font-mono");
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add as S3 Connection" })).toHaveClass("h-7");
    expect(screen.getByRole("link", { name: "Manage keys" })).toHaveAttribute("href", "/manager/users/bob/keys");
  });
});
