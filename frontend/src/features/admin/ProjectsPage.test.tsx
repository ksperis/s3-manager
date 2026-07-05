import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectsPage from "./ProjectsPage";

const listProjectsMock = vi.fn();
const createProjectMock = vi.fn();
const updateProjectMock = vi.fn();
const deleteProjectMock = vi.fn();
const fetchProjectPortalSettingsMock = vi.fn();
const updateProjectPortalSettingsMock = vi.fn();
const listMinimalS3AccountsMock = vi.fn();
const listMinimalUsersMock = vi.fn();
const listMinimalGroupsMock = vi.fn();
let portalEnabled = false;

const makePortalProjectSettings = (overrides?: Record<string, unknown>) => ({
  effective: {
    allow_portal_key: false,
    allow_portal_user_bucket_create: true,
    allow_portal_named_bucket_create: false,
    allow_portal_user_access_key_create: true,
    max_portal_user_access_keys: 2,
    iam_group_manager_policy: { actions: ["s3:ListAllMyBuckets", "sts:GetSessionToken"], advanced_policy: null },
    iam_group_user_policy: { actions: ["s3:ListAllMyBuckets"], advanced_policy: null },
    bucket_access_policy: { actions: ["s3:GetObject"], advanced_policy: null },
    bucket_defaults: {
      versioning: false,
      enable_cors: false,
      enable_lifecycle: false,
      cors_allowed_origins: ["https://portal.example.test"],
    },
  },
  admin_override: {},
  ...overrides,
});

vi.mock("../../api/projects", () => ({
  listProjects: (params?: unknown) => listProjectsMock(params),
  createProject: (payload: unknown) => createProjectMock(payload),
  updateProject: (projectId: number, payload: unknown) => updateProjectMock(projectId, payload),
  deleteProject: (projectId: number) => deleteProjectMock(projectId),
  fetchProjectPortalSettings: (projectId: number) => fetchProjectPortalSettingsMock(projectId),
  updateProjectPortalSettings: (projectId: number, payload: unknown) =>
    updateProjectPortalSettingsMock(projectId, payload),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: { portal_enabled: portalEnabled },
    loading: false,
    refresh: vi.fn(),
    setGeneralSettings: vi.fn(),
  }),
}));

vi.mock("../../utils/confirm", () => ({
  confirmAction: () => true,
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

describe("ProjectsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    portalEnabled = false;
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
    createProjectMock.mockResolvedValue({ id: 55, name: "Research Project" });
    updateProjectMock.mockResolvedValue({ id: 55, name: "Research Project" });
    deleteProjectMock.mockResolvedValue(undefined);
    fetchProjectPortalSettingsMock.mockResolvedValue(makePortalProjectSettings());
    updateProjectPortalSettingsMock.mockResolvedValue(makePortalProjectSettings());
  });

  it("shows a table loading state while projects load", async () => {
    let resolveList: (value: unknown) => void = () => {};
    listProjectsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      })
    );

    render(<ProjectsPage />);

    expect(screen.getByText("Loading projects...")).toBeInTheDocument();

    resolveList({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });
    await screen.findByText("No projects");
  });

  it("creates project links with searchable account, user, and group pickers", async () => {
    render(<ProjectsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Research Project" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Shared research storage" },
    });

    fireEvent.click(screen.getByRole("button", { name: /S3 accounts/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search S3 accounts" }), { target: { value: "paris" } });
    expect(screen.queryByRole("checkbox", { name: /project-tokyo/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("checkbox", { name: /project-paris/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: /Portal access/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search UI users" }), { target: { value: "alice" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /alice@example.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search UI groups" }), { target: { value: "ops" } });
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

  it("shows and saves portal overrides from project edits", async () => {
    portalEnabled = true;
    listProjectsMock.mockResolvedValue({
      items: [
        {
          id: 55,
          name: "Research Project",
          description: "Shared research storage",
          account_links: [],
          user_links: [],
          group_links: [],
          account_count: 0,
          user_count: 0,
          group_count: 0,
          created_at: "2026-07-05T00:00:00Z",
          updated_at: "2026-07-05T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<ProjectsPage />);

    await screen.findByText("Research Project");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Portal overrides" }));

    expect(fetchProjectPortalSettingsMock).toHaveBeenCalledWith(55);
    await screen.findByText("Portal user Storage Space creation");

    const storageSpaceCreation = screen
      .getByText("Portal user Storage Space creation")
      .closest("div")?.parentElement?.parentElement;
    const namedBucketCreation = screen.getByText("Named bucket creation").closest("div")?.parentElement?.parentElement;
    expect(storageSpaceCreation).not.toBeNull();
    expect(namedBucketCreation).not.toBeNull();
    fireEvent.change(within(storageSpaceCreation as HTMLElement).getByRole("combobox"), {
      target: { value: "disabled" },
    });
    fireEvent.change(within(namedBucketCreation as HTMLElement).getByRole("combobox"), { target: { value: "enabled" } });
    fireEvent.click(screen.getByRole("button", { name: "Save overrides" }));

    await waitFor(() => {
      expect(updateProjectPortalSettingsMock).toHaveBeenCalledWith(55, {
        allow_portal_user_bucket_create: false,
        allow_portal_named_bucket_create: true,
      });
    });
  });

  it("resets portal overrides from project edits", async () => {
    portalEnabled = true;
    listProjectsMock.mockResolvedValue({
      items: [
        {
          id: 55,
          name: "Research Project",
          description: "Shared research storage",
          account_links: [],
          user_links: [],
          group_links: [],
          account_count: 0,
          user_count: 0,
          group_count: 0,
          created_at: "2026-07-05T00:00:00Z",
          updated_at: "2026-07-05T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<ProjectsPage />);

    await screen.findByText("Research Project");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Portal overrides" }));
    await screen.findByText("Portal user Storage Space creation");
    fireEvent.click(screen.getByRole("button", { name: "Reset overrides" }));

    await waitFor(() => {
      expect(updateProjectPortalSettingsMock).toHaveBeenCalledWith(55, {});
    });
  });
});
