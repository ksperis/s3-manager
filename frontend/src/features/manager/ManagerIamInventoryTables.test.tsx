import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerGroupsPage from "./ManagerGroupsPage";
import PoliciesPage from "./PoliciesPage";
import ManagerRolesPage from "./ManagerRolesPage";

const useS3AccountContextMock = vi.fn();
const listIamGroupsMock = vi.fn();
const listIamRolesMock = vi.fn();
const listIamPoliciesMock = vi.fn();
const deleteIamGroupMock = vi.fn();
const deleteIamRoleMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    attachGroupPolicy: vi.fn(),
    createIamGroup: vi.fn(),
    deleteIamGroup: (...args: unknown[]) => deleteIamGroupMock(...args),
    listIamGroups: (...args: unknown[]) => listIamGroupsMock(...args),
  };
});

vi.mock("../../api/managerIamRoles", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamRoles")>("../../api/managerIamRoles");
  return {
    ...actual,
    attachRolePolicy: vi.fn(),
    createIamRole: vi.fn(),
    deleteIamRole: (...args: unknown[]) => deleteIamRoleMock(...args),
    getIamRole: vi.fn(),
    listIamRoles: (...args: unknown[]) => listIamRolesMock(...args),
    updateIamRole: vi.fn(),
  };
});

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    createIamPolicy: vi.fn(),
    listIamPolicies: (...args: unknown[]) => listIamPoliciesMock(...args),
  };
});

function renderManagerPage(element: ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

describe("Manager IAM inventory tables", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listIamGroupsMock.mockReset();
    listIamRolesMock.mockReset();
    listIamPoliciesMock.mockReset();
    deleteIamGroupMock.mockReset();
    deleteIamRoleMock.mockReset();
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
    listIamGroupsMock.mockResolvedValue([]);
    listIamRolesMock.mockResolvedValue([]);
    listIamPoliciesMock.mockResolvedValue([]);
  });

  it("renders groups through the shared responsive inventory table", async () => {
    listIamGroupsMock.mockResolvedValue([
      {
        name: "operators",
        arn: "arn:aws:iam::acc-1:group/operators",
        policies: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
      },
    ]);

    renderManagerPage(<ManagerGroupsPage />);

    expect(await screen.findByText("operators")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name or ARN");
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("operators").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("arn:aws:iam::acc-1:group/operators").closest("td")).toHaveAttribute("data-label", "ARN");
    expect(screen.getByText("ReadOnlyAccess").closest("td")).toHaveAttribute("data-label", "Policies");
    expect(screen.getByRole("link", { name: "Members" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");

    await waitFor(() => {
      expect(listIamGroupsMock).toHaveBeenCalledWith("acc-1");
      expect(listIamPoliciesMock).toHaveBeenCalledWith("acc-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteIamGroupMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete IAM group?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
    await waitFor(() => expect(deleteIamGroupMock).toHaveBeenCalledWith("acc-1", "operators"));
  });

  it("renders roles through the shared responsive inventory table", async () => {
    listIamRolesMock.mockResolvedValue([
      {
        name: "app-reader",
        path: "/application/",
        arn: "arn:aws:iam::acc-1:role/app-reader",
        policies: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
      },
    ]);

    renderManagerPage(<ManagerRolesPage />);

    expect(await screen.findByText("app-reader")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name, path, or ARN");
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("app-reader").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("/application/").closest("td")).toHaveAttribute("data-label", "Path");
    expect(screen.getByText("arn:aws:iam::acc-1:role/app-reader").closest("td")).toHaveAttribute("data-label", "ARN");
    expect(screen.getByText("ReadOnlyAccess").closest("td")).toHaveAttribute("data-label", "Policies");
    expect(screen.getByRole("button", { name: "Edit" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");

    await waitFor(() => {
      expect(listIamRolesMock).toHaveBeenCalledWith("acc-1");
      expect(listIamPoliciesMock).toHaveBeenCalledWith("acc-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteIamRoleMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete IAM role?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete role" }));
    await waitFor(() => expect(deleteIamRoleMock).toHaveBeenCalledWith("acc-1", "app-reader"));
  });

  it("renders policies through the shared responsive inventory table", async () => {
    listIamPoliciesMock.mockResolvedValue([
      {
        name: "ReadOnlyAccess",
        arn: "arn:aws:iam::aws:policy/ReadOnlyAccess",
        default_version_id: "v1",
      },
    ]);

    renderManagerPage(<PoliciesPage />);

    expect(await screen.findByText("ReadOnlyAccess")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search by name or ARN");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "missing" } });
    expect(screen.queryByText("ReadOnlyAccess")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "readonly" } });
    expect(screen.getByText("ReadOnlyAccess")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("ReadOnlyAccess").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("arn:aws:iam::aws:policy/ReadOnlyAccess").closest("td")).toHaveAttribute("data-label", "ARN");
    expect(screen.getByText("v1").closest("td")).toHaveAttribute("data-label", "Version");

    expect(listIamPoliciesMock).toHaveBeenCalledWith("acc-1");
  });
});
