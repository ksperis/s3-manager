import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ManagerUserPoliciesPage from "./ManagerUserPoliciesPage";

const listIamPoliciesMock = vi.fn();
const listUserPoliciesMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => ({
    selectedS3AccountType: "tenant",
    accountIdForApi: "acc-1",
    requiresS3AccountSelection: false,
    accessMode: "regular",
    accounts: [],
  }),
}));

vi.mock("../../api/managerIamPolicies", () => ({
  listIamPolicies: (accountId: unknown) => listIamPoliciesMock(accountId),
}));

vi.mock("../../api/managerIamUsers", () => ({
  attachUserPolicy: vi.fn(),
  deleteUserInlinePolicy: vi.fn(),
  detachUserPolicy: vi.fn(),
  listUserInlinePolicies: vi.fn(async () => []),
  listUserPolicies: (accountId: unknown, userName: string) => listUserPoliciesMock(accountId, userName),
  putUserInlinePolicy: vi.fn(),
}));

vi.mock("./InlinePolicyEditor", () => ({
  default: () => <div data-testid="inline-policy-editor" />,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/manager/users/alice/policies"]}>
      <Routes>
        <Route path="/manager/users/:userName/policies" element={<ManagerUserPoliciesPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ManagerUserPoliciesPage list states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps policies rows visible when refresh fails after a successful load", async () => {
    listUserPoliciesMock
      .mockResolvedValueOnce([
        {
          name: "ReadOnlyPolicy",
          arn: "arn:aws:iam::123:policy/ReadOnlyPolicy",
          default_version_id: "v1",
        },
      ])
      .mockRejectedValueOnce(new Error("Refresh policies failed"));
    listIamPoliciesMock.mockResolvedValue([
      {
        name: "ReadOnlyPolicy",
        arn: "arn:aws:iam::123:policy/ReadOnlyPolicy",
        default_version_id: "v1",
      },
    ]);

    renderPage();

    expect(await screen.findByText("ReadOnlyPolicy", { selector: "td" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Refresh policies failed")).toBeInTheDocument();
    expect(screen.getByText("ReadOnlyPolicy", { selector: "td" })).toBeInTheDocument();
    expect(screen.queryByText("Unable to load policies.")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(listUserPoliciesMock).toHaveBeenCalledTimes(2);
    });
  });
});
