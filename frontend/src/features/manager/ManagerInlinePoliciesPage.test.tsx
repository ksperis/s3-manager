import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerInlinePoliciesPage from "./ManagerInlinePoliciesPage";

const useS3AccountContextMock = vi.fn();
const listIamInlinePolicyInventoryMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    listIamInlinePolicyInventory: (...args: unknown[]) => listIamInlinePolicyInventoryMock(...args),
  };
});

function renderPage() {
  render(
    <MemoryRouter>
      <ManagerInlinePoliciesPage />
    </MemoryRouter>
  );
}

describe("ManagerInlinePoliciesPage", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listIamInlinePolicyInventoryMock.mockReset();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: null,
      requiresS3AccountSelection: true,
    });
    listIamInlinePolicyInventoryMock.mockResolvedValue([]);
  });

  it("shows an empty state when no manager context is selected", () => {
    renderPage();

    expect(screen.getByText("Select an account before reviewing inline policies")).toBeInTheDocument();
    expect(listIamInlinePolicyInventoryMock).not.toHaveBeenCalled();
  });

  it("loads configured entities and entities without inline policies", async () => {
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listIamInlinePolicyInventoryMock.mockResolvedValue([
      {
        entity_type: "user",
        entity_name: "alice",
        policies: [{ name: "ReadAlice", document: { Version: "2012-10-17", Statement: [{ Effect: "Allow" }] } }],
      },
      { entity_type: "group", entity_name: "empty-team", policies: [] },
    ]);

    renderPage();

    await waitFor(() => expect(listIamInlinePolicyInventoryMock).toHaveBeenCalledWith("account-1"));
    expect(await screen.findByText("ReadAlice")).toBeInTheDocument();
    expect(screen.getByText("1 statement • 2 top-level fields")).toBeInTheDocument();
    expect(screen.getByText("No inline policies configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "alice" })).toHaveAttribute("href", "/manager/users/alice/policies");
  });

  it("filters inline policy rows by status, entity type, and search text", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listIamInlinePolicyInventoryMock.mockResolvedValue([
      {
        entity_type: "user",
        entity_name: "alice",
        policies: [{ name: "ReadAlice", document: { Statement: [{ Action: "s3:GetObject" }] } }],
      },
      { entity_type: "role", entity_name: "batch", policies: [] },
    ]);

    renderPage();

    expect(await screen.findByText("ReadAlice")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Status/i), "no_policies");
    expect(screen.queryByText("ReadAlice")).not.toBeInTheDocument();
    expect(screen.getByText("No inline policies configured")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Status/i), "all");
    await user.selectOptions(screen.getByLabelText(/Type/i), "user");
    expect(screen.getByText("ReadAlice")).toBeInTheDocument();
    expect(screen.queryByText("batch")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Entity, policy, JSON"), "GetObject");
    expect(screen.getByText("ReadAlice")).toBeInTheDocument();
  });

  it("opens read-only JSON and links to entity policy management", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listIamInlinePolicyInventoryMock.mockResolvedValue([
      {
        entity_type: "role",
        entity_name: "batch",
        policies: [{ name: "DenyDelete", document: { Statement: [{ Sid: "DenyDelete", Action: "s3:DeleteObject" }] } }],
      },
    ]);

    renderPage();

    expect(await screen.findByText("DenyDelete")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/manager/roles/batch/policies");

    await user.click(screen.getByRole("button", { name: "View JSON" }));

    const dialog = await screen.findByRole("dialog", { name: "Inline policy JSON - Role batch" });
    expect(within(dialog).getByText("DenyDelete")).toBeInTheDocument();
    expect(within(dialog).getByText(/DeleteObject/)).toBeInTheDocument();
  });
});
