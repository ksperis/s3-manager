import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerGroupPoliciesPage from "./ManagerGroupPoliciesPage";
import ManagerRolePoliciesPage from "./ManagerRolePoliciesPage";
import ManagerUserPoliciesPage from "./ManagerUserPoliciesPage";

const listIamPoliciesMock = vi.fn();
const listUserPoliciesMock = vi.fn();
const listGroupPoliciesMock = vi.fn();
const listRolePoliciesMock = vi.fn();
const listUserInlinePoliciesMock = vi.fn();
const listGroupInlinePoliciesMock = vi.fn();
const listRoleInlinePoliciesMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => ({
    selectedS3AccountType: "tenant",
    accountIdForApi: "acc-1",
    requiresS3AccountSelection: false,
    accessMode: "regular",
    accounts: [],
  }),
}));

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    listIamPolicies: (...args: unknown[]) => listIamPoliciesMock(...args),
  };
});

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    attachUserPolicy: vi.fn(),
    deleteUserInlinePolicy: vi.fn(),
    detachUserPolicy: vi.fn(),
    listUserInlinePolicies: (...args: unknown[]) => listUserInlinePoliciesMock(...args),
    listUserPolicies: (...args: unknown[]) => listUserPoliciesMock(...args),
    putUserInlinePolicy: vi.fn(),
  };
});

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    attachGroupPolicy: vi.fn(),
    deleteGroupInlinePolicy: vi.fn(),
    detachGroupPolicy: vi.fn(),
    listGroupInlinePolicies: (...args: unknown[]) => listGroupInlinePoliciesMock(...args),
    listGroupPolicies: (...args: unknown[]) => listGroupPoliciesMock(...args),
    putGroupInlinePolicy: vi.fn(),
  };
});

vi.mock("../../api/managerIamRoles", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamRoles")>("../../api/managerIamRoles");
  return {
    ...actual,
    attachRolePolicy: vi.fn(),
    deleteRoleInlinePolicy: vi.fn(),
    detachRolePolicy: vi.fn(),
    listRoleInlinePolicies: (...args: unknown[]) => listRoleInlinePoliciesMock(...args),
    listRolePolicies: (...args: unknown[]) => listRolePoliciesMock(...args),
    putRoleInlinePolicy: vi.fn(),
  };
});

type PageCase = {
  label: string;
  path: string;
  element: JSX.Element;
};

const pages: PageCase[] = [
  {
    label: "user",
    path: "/manager/users/:userName/policies",
    element: <ManagerUserPoliciesPage />,
  },
  {
    label: "group",
    path: "/manager/groups/:groupName/policies",
    element: <ManagerGroupPoliciesPage />,
  },
  {
    label: "role",
    path: "/manager/roles/:roleName/policies",
    element: <ManagerRolePoliciesPage />,
  },
];

describe("manager entity policy pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIamPoliciesMock.mockResolvedValue([]);
    listUserPoliciesMock.mockResolvedValue([]);
    listGroupPoliciesMock.mockResolvedValue([]);
    listRolePoliciesMock.mockResolvedValue([]);
    listUserInlinePoliciesMock.mockResolvedValue([{ name: "readonly-inline", document: { Version: "2012-10-17", Statement: [] } }]);
    listGroupInlinePoliciesMock.mockResolvedValue([{ name: "readonly-inline", document: { Version: "2012-10-17", Statement: [] } }]);
    listRoleInlinePoliciesMock.mockResolvedValue([{ name: "readonly-inline", document: { Version: "2012-10-17", Statement: [] } }]);
  });

  it.each(pages)("keeps existing inline policies visible on the $label page before editing", async ({ path, element }) => {
    const url = path.replace(":userName", "alice").replace(":groupName", "admins").replace(":roleName", "auditor");

    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Existing inline policies")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /readonly-inline/i })).toBeInTheDocument();
    expect(screen.getByText("Select an existing inline policy to review or edit.")).toBeInTheDocument();
  });
});
