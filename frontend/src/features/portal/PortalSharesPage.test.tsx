import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import PortalSharesPage from "./PortalSharesPage";

const mocks = vi.hoisted(() => ({
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
      portal_role: "portal_manager",
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
          portal_role: "portal_manager",
          access_source: "direct",
          member_since: "2026-05-01T10:00:00Z",
          avatar: {
            preference: "initials",
            source: "initials",
            url: null,
            initials: "MU",
          },
          can_review_access: true,
        },
        {
          user_id: 13,
          email: "editor@example.com",
          display_name: "Editor User",
          portal_role: "portal_user",
          access_source: "direct",
          member_since: "2026-06-01T10:00:00Z",
          avatar: {
            preference: "auto",
            source: "provider",
            url: "https://idp.example.test/editor.png",
            initials: "EU",
          },
          can_review_access: true,
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
  revokePortalStorageSpacePublicLink: (...args: unknown[]) =>
    mocks.revokePublicLinkMock(...args),
}));

vi.mock("../../api/portalRequests", () => ({
  createPortalRequest: (...args: unknown[]) =>
    mocks.createPortalRequestMock(...args),
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderPage(initialEntry = "/portal/shares") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PortalSharesPage />
      <LocationProbe />
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
    mocks.hookResult.collaborators.collaborators[0].can_review_access = true;
    mocks.hookResult.collaborators.collaborators[1].can_review_access = true;
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

  it("separates project members from external links and offers access reviews", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Collaborators" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual([
      "Project members",
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
    expect(screen.queryByRole("button", { name: "Request removal" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Review access" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Editor User" })).toHaveAttribute(
      "href",
      "/portal/shares/13",
    );
    expect(screen.getAllByRole("link", { name: "Review access" })[1]).toHaveAttribute(
      "href",
      "/portal/shares/13",
    );
    expect(
      screen
        .getAllByRole("link", { name: "Open spaces" })
        .every((link) => link.getAttribute("href") === "/portal/storage-spaces"),
    ).toBe(true);
  });

  it("submits project member addition requests from the members view", async () => {
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
  });

  it("does not expose a review link when the API denies that row", async () => {
    mocks.hookResult.collaborators.collaborators[1].can_review_access = false;
    renderPage();

    expect(await screen.findByText("Editor User")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Review access" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Editor User" })).not.toBeInTheDocument();
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
