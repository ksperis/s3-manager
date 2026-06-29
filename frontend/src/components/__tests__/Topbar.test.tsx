import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Topbar from "../Topbar";

const notificationApiMock = vi.hoisted(() => ({
  fetchUserNotifications: vi.fn(),
  markUserNotificationsRead: vi.fn(),
}));

vi.mock("../ThemeToggle", () => ({
  default: () => <button type="button">Theme</button>,
}));

vi.mock("../GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      allow_user_private_connections: false,
    },
  }),
}));

vi.mock("../../features/admin/ApiTokensPage", () => ({
  default: ({ showPageHeader = true }: { showPageHeader?: boolean }) => (
    <div>{showPageHeader ? "API Tokens Page (header)" : "API Tokens Page (embedded)"}</div>
  ),
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
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_admin",
        authType: "password",
      })
    );
  });

  afterEach(() => {
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

  it("shows API tokens menu action only for superadmin role", async () => {
    const user = userEvent.setup();

    const adminRender = render(<Topbar userEmail="admin@example.com" />);
    await user.click(resolveAccountTrigger());
    expect(await screen.findByRole("menu", { name: "Account actions" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /api tokens/i })).not.toBeInTheDocument();
    adminRender.unmount();

    window.localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_superadmin",
        authType: "password",
      })
    );

    render(<Topbar userEmail="superadmin@example.com" />);
    await user.click(resolveAccountTrigger());
    expect(await screen.findByRole("menuitem", { name: /api tokens/i })).toBeInTheDocument();
  });

  it("opens API tokens modal from account menu", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_superadmin",
        authType: "password",
      })
    );

    render(<Topbar userEmail="superadmin@example.com" />);
    await user.click(resolveAccountTrigger());
    await user.click(await screen.findByRole("menuitem", { name: /api tokens/i }));

    expect(await screen.findByRole("dialog", { name: "API tokens" })).toBeInTheDocument();
    expect(await screen.findByText("API Tokens Page (embedded)")).toBeInTheDocument();
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
