import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectsPage from "./ProjectsPage";

const listProjectsMock = vi.fn();
const createProjectMock = vi.fn();
const updateProjectMock = vi.fn();
const deleteProjectMock = vi.fn();
const provisionProjectAccountsMock = vi.fn();
const listMinimalS3AccountsMock = vi.fn();
const listMinimalUsersMock = vi.fn();
const listMinimalGroupsMock = vi.fn();
const listStorageEndpointsMock = vi.fn();

vi.mock("../../api/projects", () => ({
  listProjects: (params?: unknown) => listProjectsMock(params),
  createProject: (payload: unknown) => createProjectMock(payload),
  updateProject: (projectId: number, payload: unknown) => updateProjectMock(projectId, payload),
  deleteProject: (projectId: number) => deleteProjectMock(projectId),
  provisionProjectAccounts: (projectId: number, payload: unknown) =>
    provisionProjectAccountsMock(projectId, payload),
}));

vi.mock("../../api/accounts", () => ({
  listMinimalS3Accounts: () => listMinimalS3AccountsMock(),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
}));

vi.mock("../../api/groups", () => ({
  listMinimalGroups: () => listMinimalGroupsMock(),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
}));

describe("ProjectsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProjectsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });
    listMinimalS3AccountsMock.mockResolvedValue([
      {
        id: "RGW0001",
        db_id: 101,
        name: "project-paris",
        tags: [],
        rgw_account_id: "RGW-PARIS",
        storage_endpoint_name: "Paris",
        storage_endpoint_url: "https://paris.example.test",
      },
      {
        id: "RGW0002",
        db_id: 102,
        name: "project-tokyo",
        tags: [],
        rgw_account_id: "RGW-TOKYO",
        storage_endpoint_name: "Tokyo",
        storage_endpoint_url: "https://tokyo.example.test",
      },
    ]);
    listMinimalUsersMock.mockResolvedValue([
      { id: 7, email: "alice@example.com" },
      { id: 8, email: "bob@example.com" },
    ]);
    listMinimalGroupsMock.mockResolvedValue([
      { id: 12, name: "Ops Team" },
      { id: 13, name: "Archive Team" },
    ]);
    listStorageEndpointsMock.mockResolvedValue([]);
    createProjectMock.mockResolvedValue({ id: 55, name: "Research Project" });
    updateProjectMock.mockResolvedValue({ id: 55, name: "Research Project" });
    deleteProjectMock.mockResolvedValue(undefined);
    provisionProjectAccountsMock.mockResolvedValue({
      project: { id: 55, name: "Research Project" },
      created_account_ids: [],
      reused_endpoint_ids: [],
    });
  });

  it("creates project links with searchable account, user, and group pickers", async () => {
    render(<ProjectsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Research Project" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Shared research storage" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "paris" } });
    expect(screen.queryByRole("checkbox", { name: /project-tokyo/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("checkbox", { name: /project-paris/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "alice" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /alice@example.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "ops" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ops Team/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "Research Project",
        description: "Shared research storage",
        account_links: [{ account_id: 101, display_name: "Paris", sort_order: 0 }],
        user_links: [{ user_id: 7, account_role: "portal_user" }],
        group_links: [{ group_id: 12, account_role: "portal_user" }],
      });
    });
  });
});
