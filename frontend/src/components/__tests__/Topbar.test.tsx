import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Topbar from "../Topbar";

vi.mock("../EnvironmentSwitcher", () => ({
  default: () => <div data-testid="environment-switcher" />,
  useWorkspaceSwitcherModel: () => null,
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

const resolveAccountTrigger = (): HTMLButtonElement => {
  const trigger = screen
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-haspopup") === "menu");
  if (!trigger) {
    throw new Error("Unable to find account menu trigger.");
  }
  return trigger as HTMLButtonElement;
};

describe("Topbar account menu", () => {
  beforeEach(() => {
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
});
