import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUserCache } from "../../utils/workspaces";
import Topbar from "../Topbar";

const notificationApiMock = vi.hoisted(() => ({
  clearReadUserNotifications: vi.fn(),
  deleteUserNotification: vi.fn(),
  fetchUserNotifications: vi.fn(),
  markUserNotificationsRead: vi.fn(),
}));

vi.mock("../ThemeToggle", () => ({
  default: () => <button type="button">Theme</button>,
}));

vi.mock("../GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
    },
  }),
}));

vi.mock("../../api/userNotifications", () => notificationApiMock);

const resolveAccountTrigger = (): HTMLButtonElement => {
  const trigger = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.includes("@example.com"));
  if (!trigger) {
    throw new Error("Unable to find account menu trigger.");
  }
  return trigger as HTMLButtonElement;
};

describe("Topbar account menu", () => {
  beforeEach(() => {
    notificationApiMock.fetchUserNotifications.mockReset();
    notificationApiMock.fetchUserNotifications.mockResolvedValue({ items: [], unread_count: 0 });
    notificationApiMock.markUserNotificationsRead.mockReset();
    notificationApiMock.markUserNotificationsRead.mockResolvedValue({ updated_count: 0, unread_count: 0 });
    notificationApiMock.deleteUserNotification.mockReset();
    notificationApiMock.deleteUserNotification.mockResolvedValue({ deleted_count: 0, unread_count: 0 });
    notificationApiMock.clearReadUserNotifications.mockReset();
    notificationApiMock.clearReadUserNotifications.mockResolvedValue({ deleted_count: 0, unread_count: 0 });
    setSessionUserCache({
      role: "ui_admin",
      authType: "password",
      can_create_manual_private_connections: true,
    });
  });

  afterEach(() => {
    act(() => setSessionUserCache(null));
    window.localStorage.clear();
  });

  it("opens with keyboard and supports arrow navigation + Escape close", async () => {
    const user = userEvent.setup();
    render(<Topbar userEmail="admin@example.com" />);

    const trigger = resolveAccountTrigger();
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu", { name: "Account actions" });
    expect(menu).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /user profile/i })).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: "ArrowDown" });
    const connectionsItem = screen.getByRole("menuitem", { name: /private s3 connections/i });
    expect(connectionsItem).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Account actions" })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("uses the stored profile avatar in the trigger and account menu", async () => {
    const user = userEvent.setup();
    setSessionUserCache({
      role: "ui_admin",
      authType: "password",
      full_name: "Admin User",
      avatar: {
        preference: "initials",
        source: "initials",
        url: null,
        initials: "AU",
      },
    });

    render(<Topbar userEmail="admin@example.com" />);

    const trigger = resolveAccountTrigger();
    expect(within(trigger).getByTitle("Admin User")).toHaveTextContent("AU");
    await user.click(trigger);
    const menu = await screen.findByRole("menu", { name: "Account actions" });
    expect(within(menu).getByTitle("Admin User")).toHaveTextContent("AU");
    expect(within(menu).getByText("admin@example.com")).toBeInTheDocument();
  });

  it("refreshes the topbar avatar after a profile update", async () => {
    render(<Topbar userEmail="admin@example.com" />);
    const trigger = resolveAccountTrigger();

    act(() => setSessionUserCache({
        role: "ui_admin",
        authType: "password",
        full_name: "New User",
        avatar: {
          preference: "initials",
          source: "initials",
          url: null,
          initials: "NU",
        },
    }));

    await waitFor(() => {
      expect(within(trigger).getByTitle("New User")).toHaveTextContent("NU");
    });
  });

  it("closes on outside click", async () => {
    const user = userEvent.setup();
    render(<Topbar userEmail="admin@example.com" />);

    const trigger = resolveAccountTrigger();
    await user.click(trigger);
    expect(await screen.findByRole("menu", { name: "Account actions" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Account actions" })).not.toBeInTheDocument();
    });
  });

  it("keeps automation tokens out of the personal account menu", async () => {
    const user = userEvent.setup();

    const adminRender = render(<Topbar userEmail="admin@example.com" />);
    await user.click(resolveAccountTrigger());
    expect(await screen.findByRole("menu", { name: "Account actions" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /api tokens/i })).not.toBeInTheDocument();
    adminRender.unmount();

    setSessionUserCache({ role: "ui_superadmin", authType: "password" });

    render(<Topbar userEmail="superadmin@example.com" />);
    await user.click(resolveAccountTrigger());
    expect(await screen.findByRole("menu", { name: "Account actions" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /api tokens/i })).not.toBeInTheDocument();
  });

  it("links profile and private connections to the shared profile page", async () => {
    const user = userEvent.setup();
    render(<Topbar userEmail="admin@example.com" />);

    await user.click(resolveAccountTrigger());
    expect(await screen.findByRole("menuitem", { name: /user profile/i })).toHaveAttribute("href", "/profile?tab=profile");
    expect(screen.getByRole("menuitem", { name: /private s3 connections/i })).toHaveAttribute(
      "href",
      "/profile?tab=connections"
    );
    expect(screen.queryByRole("dialog", { name: /user profile|private s3 connections/i })).not.toBeInTheDocument();
  });

  it("opens an empty notifications panel", async () => {
    const user = userEvent.setup();
    render(<Topbar userEmail="admin@example.com" />);

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByRole("menu", { name: "Notifications" })).toBeInTheDocument();
    expect(await screen.findByText("No notifications.")).toBeInTheDocument();
  });

  it("shows quota notifications with unread badge and marks them as read", async () => {
    const user = userEvent.setup();
    const unreadNotification = {
      id: 42,
      type: "quota_alert",
      severity: "warning",
      title: "Quota near limit",
      message: "RGW account Lab account is near its quota limit (90.000%).",
      subject_type: "account",
      storage_endpoint_id: 7,
      s3_account_id: 12,
      s3_user_id: null,
      payload: {
        alert_level: "threshold",
        subject_type: "account",
        subject_label: "RGW account",
        subject_name: "Lab account",
        endpoint_name: "Lab endpoint",
        threshold_percent: 85,
        usage_ratio_pct: 90,
        used_bytes: 90 * 1024 * 1024,
        quota_size_bytes: 100 * 1024 * 1024,
        used_objects: 90,
        quota_objects: 100,
        checked_at: "2026-01-11T09:00:00",
      },
      created_at: "2026-01-11T09:00:00",
      read_at: null,
    };
    notificationApiMock.fetchUserNotifications
      .mockResolvedValueOnce({ items: [unreadNotification], unread_count: 1 })
      .mockResolvedValueOnce({ items: [unreadNotification], unread_count: 1 })
      .mockResolvedValueOnce({
        items: [{ ...unreadNotification, read_at: "2026-01-11T09:01:00" }],
        unread_count: 0,
      });
    notificationApiMock.markUserNotificationsRead.mockResolvedValue({ updated_count: 1, unread_count: 0 });

    render(<Topbar userEmail="admin@example.com" />);

    expect(await screen.findByText("1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("Quota near limit")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("90.0%")).toBeInTheDocument();
    expect(screen.getByText("Lab endpoint")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark all as read" }));

    await waitFor(() => {
      expect(notificationApiMock.markUserNotificationsRead).toHaveBeenCalledWith({ all: true });
    });
    expect(await screen.findByText("0 unread")).toBeInTheDocument();
  });

  it("renders typed notification details and deletes individual and read rows", async () => {
    const user = userEvent.setup();
    const identityNotification = {
      id: 51,
      type: "identity_link_request",
      severity: "warning",
      title: "Identity link approval requested",
      message: "person@example.test requested an external identity link.",
      subject_type: "identity_request",
      payload: {
        target_user_email: "person@example.test",
        provider_type: "oidc",
        provider_id: "company",
        expires_at: "2026-01-12T09:00:00Z",
      },
      created_at: "2026-01-11T09:00:00Z",
      read_at: "2026-01-11T09:05:00Z",
    };
    const endpointNotification = {
      id: 52,
      type: "endpoint_health",
      severity: "error",
      title: "Endpoint unavailable",
      message: "Endpoint Production is down: connection refused",
      subject_type: "endpoint",
      storage_endpoint_id: 9,
      payload: {
        endpoint_name: "Production",
        current_status: "down",
        check_mode: "s3",
        latency_ms: 238,
        checked_at: "2026-01-11T10:00:00Z",
      },
      created_at: "2026-01-11T10:00:00Z",
      read_at: null,
    };
    const initialPayload = {
      items: [endpointNotification, identityNotification],
      unread_count: 1,
    };
    notificationApiMock.fetchUserNotifications
      .mockResolvedValueOnce(initialPayload)
      .mockResolvedValueOnce(initialPayload)
      .mockResolvedValueOnce({ items: [identityNotification], unread_count: 0 })
      .mockResolvedValueOnce({ items: [], unread_count: 0 });
    notificationApiMock.deleteUserNotification.mockResolvedValue({ deleted_count: 1, unread_count: 0 });
    notificationApiMock.clearReadUserNotifications.mockResolvedValue({ deleted_count: 1, unread_count: 0 });

    render(<Topbar userEmail="admin@example.com" />);

    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Identity link approval requested")).toBeInTheDocument();
    expect(screen.getByText("User", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("person@example.test", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("oidc:company")).toBeInTheDocument();
    expect(screen.getByText("Production", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("down")).toBeInTheDocument();
    expect(screen.getByText("238 ms")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete notification: Endpoint unavailable" }));

    await waitFor(() => {
      expect(notificationApiMock.deleteUserNotification).toHaveBeenCalledWith(52);
    });
    expect(screen.queryByText("Endpoint unavailable")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear read" }));

    await waitFor(() => {
      expect(notificationApiMock.clearReadUserNotifications).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("No notifications.")).toBeInTheDocument();
  });

  it("keeps the notifications menu open when delete APIs fail", async () => {
    const user = userEvent.setup();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    notificationApiMock.fetchUserNotifications.mockResolvedValue({
      items: [
        {
          id: 61,
          type: "endpoint_health",
          severity: "error",
          title: "Endpoint unavailable",
          message: "Endpoint Production is down.",
          subject_type: "endpoint",
          payload: {},
          created_at: "2026-01-11T10:00:00Z",
          read_at: null,
        },
        {
          id: 62,
          type: "identity_link_request",
          severity: "warning",
          title: "Identity request",
          message: "An identity link needs review.",
          subject_type: "identity_request",
          payload: {},
          created_at: "2026-01-11T09:00:00Z",
          read_at: "2026-01-11T09:05:00Z",
        },
      ],
      unread_count: 1,
    });
    notificationApiMock.deleteUserNotification.mockRejectedValue(new Error("delete failed"));
    notificationApiMock.clearReadUserNotifications.mockRejectedValue(new Error("clear failed"));

    render(<Topbar userEmail="admin@example.com" />);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await screen.findByText("Endpoint unavailable");

    await user.click(screen.getByRole("button", { name: "Delete notification: Endpoint unavailable" }));
    expect(await screen.findByText("Unable to delete notification.")).toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Notifications" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear read" }));
    expect(await screen.findByText("Unable to clear read notifications.")).toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Notifications" })).toBeInTheDocument();
    warnSpy.mockRestore();
  });

  it("renders the workspace selector in the topbar when requested", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Topbar
        userEmail="admin@example.com"
        section="Browser"
        showWorkspaceSwitcher
        workspaceSwitcher={{
          currentWorkspaceId: "browser",
          currentWorkspaceLabel: "Browser",
          options: [
            { value: "manager", label: "Manager" },
            { value: "browser", label: "Browser" },
          ],
          onChange,
        }}
      />
    );

    const switcher = screen.getByRole("button", { name: "Switch workspace" });
    expect(switcher).toHaveTextContent("Workspace");
    expect(switcher).toHaveTextContent("Browser");
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();

    await user.click(switcher);
    await user.click(await screen.findByRole("option", { name: "Manager" }));
    expect(onChange).toHaveBeenCalledWith("manager");
  });

  it("keeps workspace and account controls in the topbar when the sidebar is visible", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });

    try {
      render(
        <Topbar
          userEmail="admin@example.com"
          section="Manager"
          showMobileMenuButton
          showWorkspaceSwitcher
          workspaceSwitcher={{
            currentWorkspaceId: "manager",
            currentWorkspaceLabel: "Manager",
            options: [
              { value: "manager", label: "Manager" },
              { value: "browser", label: "Browser" },
            ],
            onChange: vi.fn(),
          }}
          controlDescriptors={[
            {
              id: "account",
              icon: null,
              selectedLabel: "Lab account",
              priority: 10,
              estimatedIconWidth: 36,
              estimatedLabelWidth: 180,
              renderControl: () => (
                <button type="button" aria-label="Select context account">
                  Account Lab account
                </button>
              ),
            },
          ]}
        />
      );

      await waitFor(() => {
        expect(notificationApiMock.fetchUserNotifications).toHaveBeenCalled();
      });

      const topbar = document.querySelector("[data-topbar]");
      expect(topbar).not.toBeNull();
      expect(within(topbar as HTMLElement).getByRole("button", { name: "Switch workspace" })).toHaveTextContent("Manager");
      expect(within(topbar as HTMLElement).getByRole("button", { name: "Select context account" })).toHaveTextContent(
        "Lab account"
      );
      expect(within(topbar as HTMLElement).queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalWidth });
    }
  });
});
