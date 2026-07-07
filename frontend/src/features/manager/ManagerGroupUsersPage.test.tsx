import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerGroupUsersPage from "./ManagerGroupUsersPage";

const useS3AccountContextMock = vi.fn();
const listIamGroupUsersMock = vi.fn();
const listIamUsersMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    addIamGroupUser: vi.fn(),
    listIamGroupUsers: (...args: unknown[]) => listIamGroupUsersMock(...args),
    removeIamGroupUser: vi.fn(),
  };
});

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    listIamUsers: (...args: unknown[]) => listIamUsersMock(...args),
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/manager/groups/operators/users"]}>
      <Routes>
        <Route path="/manager/groups/:groupName/users" element={<ManagerGroupUsersPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ManagerGroupUsersPage", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listIamGroupUsersMock.mockReset();
    listIamUsersMock.mockReset();
    useS3AccountContextMock.mockReturnValue({
      selectedS3AccountType: "tenant",
      accountIdForApi: "acc-1",
      requiresS3AccountSelection: false,
      accessMode: "default",
    });
    listIamGroupUsersMock.mockResolvedValue([]);
    listIamUsersMock.mockResolvedValue([]);
  });

  it("renders group members through the shared responsive table", async () => {
    listIamGroupUsersMock.mockResolvedValue([
      {
        name: "alice",
        arn: "arn:aws:iam::acc-1:user/alice",
      },
    ]);
    listIamUsersMock.mockResolvedValue([
      {
        name: "alice",
        arn: "arn:aws:iam::acc-1:user/alice",
      },
      {
        name: "bob",
        arn: "arn:aws:iam::acc-1:user/bob",
      },
    ]);

    renderPage();

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("alice").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("arn:aws:iam::acc-1:user/alice").closest("td")).toHaveAttribute("data-label", "ARN");
    expect(screen.getByRole("button", { name: "Remove" }).closest("td")).toHaveAttribute(
      "data-mobile-actions",
      "true"
    );

    await waitFor(() => {
      expect(listIamGroupUsersMock).toHaveBeenCalledWith("acc-1", "operators");
      expect(listIamUsersMock).toHaveBeenCalledWith("acc-1");
    });
  });
});
