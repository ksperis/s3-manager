import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PortalSharesPage from "./PortalSharesPage";

const mocks = vi.hoisted(() => ({
  listSharesMock: vi.fn(),
  listPublicLinksMock: vi.fn(),
  revokePublicLinkMock: vi.fn(),
  createPortalRequestMock: vi.fn(),
  hookResult: {
    workspace: {
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          role: "Manager",
          status: "Active",
          access: "Shared",
          ownerUserId: 7,
          visibility: "shared",
          region: "eu-west-3",
          createdLabel: "May 10, 2023",
          shareCount: 1,
        },
      ],
    },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
    accountIdForApi: "101",
    state: {
      account_role: "portal_manager",
      can_manage_portal_users: true,
    },
    collaborators: {
      summary: {
        collaborator_count: 2,
        external_access_key_count: 1,
        trend: null,
      },
      collaborators: [
        {
          user_id: 7,
          email: "manager@example.com",
          display_name: "Manager User",
          account_role: "portal_manager",
          access_source: "direct",
          member_since: "2026-05-01T10:00:00Z",
          avatar: {
            preference: "initials",
            source: "initials",
            url: null,
            initials: "MU",
          },
        },
        {
          user_id: 13,
          email: "editor@example.com",
          display_name: "Editor User",
          account_role: "portal_user",
          access_source: "direct",
          member_since: "2026-06-01T10:00:00Z",
          avatar: {
            preference: "auto",
            source: "provider",
            url: "https://idp.example.test/editor.png",
            initials: "EU",
          },
        },
      ],
    },
    collaboratorsLoading: false,
    collaboratorsError: null,
    refreshWorkspaceData: vi.fn(),
  },
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

vi.mock("../../api/portal", () => ({
  listPortalStorageSpacePublicLinks: (...args: unknown[]) =>
    mocks.listPublicLinksMock(...args),
  listPortalStorageSpaceShares: (...args: unknown[]) =>
    mocks.listSharesMock(...args),
  revokePortalStorageSpacePublicLink: (...args: unknown[]) =>
    mocks.revokePublicLinkMock(...args),
}));

vi.mock("../../api/portalRequests", () => ({
  createPortalRequest: (...args: unknown[]) =>
    mocks.createPortalRequestMock(...args),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PortalSharesPage />
    </MemoryRouter>,
  );
}

describe("PortalSharesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/portal/shares");
    mocks.hookResult.workspace.spaces = [
      {
        id: "research-data",
        name: "Research Data",
        role: "Manager",
        status: "Active",
        access: "Shared",
        ownerUserId: 7,
        visibility: "shared",
        region: "eu-west-3",
        createdLabel: "May 10, 2023",
        shareCount: 1,
      },
    ];
    mocks.listSharesMock.mockResolvedValue([
      {
        id: "research-data:12",
        storage_space_id: "research-data",
        storage_space_name: "Research Data",
        user_id: 12,
        email: "viewer@example.com",
        role: "Viewer",
        direction: "by_me",
        activity_label: "Active",
      },
    ]);
    mocks.listPublicLinksMock.mockResolvedValue([
      {
        id: 42,
        storage_space_id: "research-data",
        storage_space_name: "Research Data",
        object_key: "raw-data/report.csv",
        object_name: "report.csv",
        url: "/api/portal/public-links/token/download",
        status: "Active",
        created_at: "2026-06-01T10:00:00Z",
        expires_at: "2026-06-10T10:00:00Z",
      },
    ]);
    mocks.revokePublicLinkMock.mockResolvedValue([]);
    mocks.createPortalRequestMock.mockResolvedValue({ id: 73, status: "pending" });
  });

  it("separates project membership, space access, and external links", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Collaborators" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual([
      "Project members",
      "Access by space",
      "External links",
    ]);
    expect(screen.queryByText(/A project member does not automatically have access to every file/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("tabpanel", { name: "Project members" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Project members" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Manager User")).toBeInTheDocument();
    expect(screen.getByText("Project role")).toBeInTheDocument();
    expect(screen.queryByText("Workspace role")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request member" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request removal" })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link", { name: "Open spaces" })
        .every((link) => link.getAttribute("href") === "/portal/storage-spaces"),
    ).toBe(true);
  });

  it("submits project member addition and removal requests from the members view", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Request member" }));
    const addDialog = screen.getByRole("dialog", { name: "Request a project member" });
    await user.type(within(addDialog).getByLabelText("Name"), "New Member");
    await user.type(within(addDialog).getByLabelText("Email"), "new.member@example.org");
    await user.type(within(addDialog).getByLabelText("Reason (optional)"), "Project onboarding");
    await user.click(within(addDialog).getByRole("button", { name: "Send request" }));

    await waitFor(() =>
      expect(mocks.createPortalRequestMock).toHaveBeenCalledWith("101", {
        request_type: "portal_user_access",
        target_name: "New Member",
        target_email: "new.member@example.org",
        reason: "Project onboarding",
      }),
    );
    expect(await screen.findByText("Member request sent. Track it in Help requests.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Request removal" }));
    const removeDialog = screen.getByRole("dialog", { name: "Request member removal" });
    expect(within(removeDialog).getByText("Editor User")).toBeInTheDocument();
    await user.click(within(removeDialog).getByRole("button", { name: "Send removal request" }));

    await waitFor(() =>
      expect(mocks.createPortalRequestMock).toHaveBeenLastCalledWith("101", {
        request_type: "portal_user_removal",
        target_name: "Editor User",
        target_email: "editor@example.com",
        reason: null,
      }),
    );
    expect(await screen.findByText("Removal request sent. Track it in Help requests.")).toBeInTheDocument();
  });

  it("keeps the global access overview read-only and routes management to the space", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Access by space" }));
    await user.click(screen.getByRole("tab", { name: "Granted by me" }));

    expect(await screen.findByText("viewer@example.com")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Access for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage in space" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data?tab=collaborators",
    );
    expect(screen.getByRole("link", { name: "Research Data" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data?tab=collaborators",
    );
  });

  it("opens the canonical access view from the URL", async () => {
    window.history.pushState({}, "", "/portal/shares?view=access");
    renderPage();

    expect(
      await screen.findByRole("tabpanel", { name: "Access by space" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Access by space" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Shared with me" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("filters project members client-side", async () => {
    const user = userEvent.setup();
    renderPage();

    const membersPanel = await screen.findByRole("tabpanel", { name: "Project members" });
    await user.type(within(membersPanel).getByLabelText("Search members"), "manager");

    expect(within(membersPanel).getByText("Manager User")).toBeInTheDocument();
    expect(within(membersPanel).queryByText("Editor User")).not.toBeInTheDocument();
    expect(within(membersPanel).getByText("1 of 2 members")).toBeInTheDocument();
  });

  it("loads access for every active space but excludes archived spaces", async () => {
    mocks.hookResult.workspace.spaces = [
      mocks.hookResult.workspace.spaces[0],
      {
        ...mocks.hookResult.workspace.spaces[0],
        id: "private-data",
        name: "Private Data",
        role: "Owner",
        visibility: "private",
      },
      {
        ...mocks.hookResult.workspace.spaces[0],
        id: "archived-data",
        name: "Archived Data",
        status: "Archived",
      },
    ];
    renderPage();

    await waitFor(() => expect(mocks.listSharesMock).toHaveBeenCalledTimes(2));
    expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "research-data");
    expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "private-data");
    expect(mocks.listSharesMock).not.toHaveBeenCalledWith("101", "archived-data");
  });

  it("lists, filters, and copies external links", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "External links" }));
    expect(screen.getByLabelText("Filter by space")).toHaveValue("");
    expect(
      screen
        .getAllByRole("link", { name: "Open spaces" })
        .every((link) => link.getAttribute("href") === "/portal/storage-spaces"),
    ).toBe(true);
    expect(await screen.findByText("report.csv")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by space"), "research-data");
    expect(screen.getByRole("link", { name: "Open files" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data#space-files",
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(
      "/api/portal/public-links/token/download",
    );
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("confirms external-link revocation", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "External links" }));
    expect(await screen.findByText("report.csv")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke public link" });
    expect(within(dialog).getByText("report.csv")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Revoke link" }));

    await waitFor(() => {
      expect(mocks.revokePublicLinkMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        42,
      );
    });
  });

  it("explains external-link permissions when no managed team space exists", async () => {
    const user = userEvent.setup();
    mocks.hookResult.workspace.spaces = [
      {
        ...mocks.hookResult.workspace.spaces[0],
        id: "private-data",
        name: "Private Data",
        role: "Owner",
        visibility: "private",
      },
    ];
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "External links" }));
    expect(
      await screen.findByText(
        /Only project managers can create public links from active team spaces/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by space")).not.toBeInTheDocument();
  });
});
