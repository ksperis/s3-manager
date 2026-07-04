import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectAssociationEditor from "./ProjectAssociationEditor";
import type { Project } from "../../api/projects";

const listProjectsMock = vi.fn();
const updateProjectMock = vi.fn();

vi.mock("../../api/projects", () => ({
  listProjects: (params?: unknown) => listProjectsMock(params),
  updateProject: (projectId: number, payload: unknown) => updateProjectMock(projectId, payload),
}));

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 1,
    name: "Default Project",
    description: null,
    account_links: [],
    user_links: [],
    group_links: [],
    account_count: 0,
    user_count: 0,
    group_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ProjectAssociationEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProjectMock.mockResolvedValue(undefined);
  });

  it("loads every project page before offering association choices", async () => {
    listProjectsMock
      .mockResolvedValueOnce({
        items: [makeProject({ id: 61, name: "First Page Project" })],
        total: 2,
        page: 1,
        page_size: 200,
        has_next: true,
      })
      .mockResolvedValueOnce({
        items: [makeProject({ id: 62, name: "Second Page Project" })],
        total: 2,
        page: 2,
        page_size: 200,
        has_next: false,
      });

    render(<ProjectAssociationEditor target={{ kind: "user", id: 7, label: "alice@example.com" }} />);

    await waitFor(() => {
      expect(listProjectsMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Add projects" }));

    expect(screen.getByRole("checkbox", { name: /First Page Project/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Second Page Project/ })).toBeInTheDocument();
  });

  it("adds an account to a searched project with a portal label", async () => {
    const projects = [
      makeProject({
        id: 41,
        name: "Genome Project",
        description: "Paris storage",
      }),
      makeProject({
        id: 42,
        name: "Archive Project",
      }),
    ];
    listProjectsMock
      .mockResolvedValueOnce({ items: projects, total: 2, page: 1, page_size: 200, has_next: false })
      .mockResolvedValueOnce({
        items: [
          makeProject({
            ...projects[0],
            account_links: [
              {
                account_id: 7,
                account_name: "research",
                display_name: "Paris",
                sort_order: 0,
              },
            ],
          }),
          projects[1],
        ],
        total: 2,
        page: 1,
        page_size: 200,
        has_next: false,
      });

    render(
      <ProjectAssociationEditor
        target={{ kind: "account", id: 7, label: "research", defaultDisplayName: "Paris" }}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add projects" }));
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "genome" } });
    expect(screen.queryByText("Archive Project")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /Genome Project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    expect(screen.getByDisplayValue("Paris")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save project links" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith(41, {
        account_links: [{ account_id: 7, display_name: "Paris", sort_order: 0 }],
      });
    });
  });

  it("adds a UI group to a searched project with a portal role", async () => {
    const projects = [
      makeProject({
        id: 51,
        name: "Operations Project",
        description: "Platform operations",
      }),
      makeProject({
        id: 52,
        name: "Archive Project",
      }),
    ];
    listProjectsMock
      .mockResolvedValueOnce({ items: projects, total: 2, page: 1, page_size: 200, has_next: false })
      .mockResolvedValueOnce({
        items: [
          makeProject({
            ...projects[0],
            group_links: [{ group_id: 12, group_name: "Ops", account_role: "portal_manager" }],
            group_count: 1,
          }),
          projects[1],
        ],
        total: 2,
        page: 1,
        page_size: 200,
        has_next: false,
      });

    render(<ProjectAssociationEditor target={{ kind: "group", id: 12, label: "Ops" }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add projects" }));
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "operations" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Operations Project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "portal_manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Save project links" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith(51, {
        group_links: [{ group_id: 12, account_role: "portal_manager" }],
      });
    });
  });
});
