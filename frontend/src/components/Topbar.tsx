/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type KeyboardEvent as ReactKeyboardEvent, ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  fetchUserNotifications,
  markUserNotificationsRead,
  type UserNotification,
} from "../api/userNotifications";
import type { EffectiveUserAccess, UiRole, UserAvatarDescriptor } from "../api/users";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  canAccessPrivateConnectionsSection,
  readStoredUser,
  SESSION_USER_UPDATED_EVENT,
} from "../utils/workspaces";
import type { WorkspaceSwitcherModel } from "./EnvironmentSwitcher";
import ThemeToggle from "./ThemeToggle";
import type { TopbarControlDescriptor } from "./topbarControlsLayout";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { useDismissibleLayer } from "./ui/useDismissibleLayer";
import UserAvatar from "./UserAvatar";

type TopbarProps = {
  projectName?: string;
  section?: string;
  inlineContent?: ReactNode;
  controlsContent?: ReactNode;
  controlDescriptors?: TopbarControlDescriptor[];
  userEmail?: string | null;
  onLogout?: () => void;
  contextAction?: ReactNode;
  showMobileMenuButton?: boolean;
  mobileMenuOpen?: boolean;
  onMobileMenuToggle?: () => void;
  showWorkspaceSwitcher?: boolean;
  workspaceSwitcher?: WorkspaceSwitcherModel | null;
  profilePath?: string;
};

type StoredAccountLink = {
  account_id: number;
};

type StoredTopbarUser = {
  full_name?: string | null;
  avatar?: UserAvatarDescriptor | null;
  role?: UiRole | null;
  can_create_manual_private_connections?: boolean | null;
  can_provision_managed_private_connections?: boolean | null;
  effective_access?: Pick<
    EffectiveUserAccess,
    | "can_create_manual_private_connections"
    | "can_provision_managed_private_connections"
    | "has_owned_private_connections"
  > | null;
  authType?: "password" | "s3_session" | "oidc" | "ldap" | null;
  account_links?: StoredAccountLink[] | null;
};

function resolveUiRoleLabel(user: StoredTopbarUser | null): string {
  if (!user) return "Unknown";
  if (user.authType === "s3_session") return "S3 Session";
  if (user.role === "ui_superadmin") return "Superadmin";
  if (user.role === "ui_admin") return "Admin";
  if (user.role === "ui_user") return "User";
  if (user.role === "ui_none") return "No access";
  return "Unknown";
}

function compactWorkspaceLabel(label?: string | null): string {
  const normalized = (label ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!normalized) return "Workspace";
  if (normalized.toLowerCase() === "administration") return "Admin";
  return normalized;
}

function formatPercent(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value.toFixed(1)}%`;
}

function formatBytes(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let amount = Math.max(0, value);
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function formatCount(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value).toLocaleString();
}

function formatDateTime(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Topbar({
  section,
  inlineContent,
  controlsContent,
  controlDescriptors,
  userEmail,
  onLogout,
  contextAction,
  showMobileMenuButton = false,
  mobileMenuOpen = false,
  onMobileMenuToggle,
  showWorkspaceSwitcher = true,
  workspaceSwitcher,
  profilePath = "/profile",
}: TopbarProps) {
  const [storedUser, setStoredUser] = useState<StoredTopbarUser | null>(
    () => readStoredUser() as StoredTopbarUser | null,
  );
  const isS3Session = storedUser?.authType === "s3_session";
  const canAccessPrivateConnections =
    !isS3Session && canAccessPrivateConnectionsSection(storedUser);
  const uiRoleLabel = useMemo(() => resolveUiRoleLabel(storedUser), [storedUser]);

  const isMobileViewport = useMediaQuery("(max-width: 767px)");
  const [controlsAvailableWidth, setControlsAvailableWidth] = useState<number>(Number.POSITIVE_INFINITY);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRootRef = useRef<HTMLDivElement | null>(null);
  const accountMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const accountMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuId = useId();

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const notificationsRootRef = useRef<HTMLDivElement | null>(null);
  const notificationsSurfaceRef = useRef<HTMLDivElement | null>(null);
  const notificationsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const notificationsMenuId = useId();

  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceActiveIndex, setWorkspaceActiveIndex] = useState(-1);
  const workspaceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceListboxRef = useRef<HTMLDivElement | null>(null);
  const workspaceListboxId = useId();

  const controlsStripRef = useRef<HTMLDivElement | null>(null);

  const accountDisplay = userEmail ?? "Session";
  const accountName = storedUser?.full_name?.trim() || accountDisplay;
  const accountAvatarName = accountName === accountDisplay ? null : accountName;
  const showNotifications = !isS3Session;

  useDismissibleLayer({
    open: workspaceMenuOpen,
    insideRefs: [workspaceTriggerRef, workspaceMenuSurfaceRef],
    onDismiss: (reason) => {
      setWorkspaceMenuOpen(false);
      if (reason === "escape") workspaceTriggerRef.current?.focus();
    },
    preventEscapeDefault: true,
  });
  useDismissibleLayer({
    open: accountMenuOpen,
    insideRefs: [accountMenuRootRef, accountMenuSurfaceRef],
    onDismiss: (reason) => {
      setAccountMenuOpen(false);
      if (reason === "escape") accountMenuTriggerRef.current?.focus();
    },
    preventEscapeDefault: true,
  });
  useDismissibleLayer({
    open: notificationsOpen,
    insideRefs: [notificationsRootRef, notificationsSurfaceRef],
    onDismiss: (reason) => {
      setNotificationsOpen(false);
      if (reason === "escape") notificationsTriggerRef.current?.focus();
    },
    preventEscapeDefault: true,
  });

  useEffect(() => {
    const syncStoredUser = () => {
      setStoredUser(readStoredUser() as StoredTopbarUser | null);
    };
    window.addEventListener(SESSION_USER_UPDATED_EVENT, syncStoredUser);
    window.addEventListener("storage", syncStoredUser);
    return () => {
      window.removeEventListener(SESSION_USER_UPDATED_EVENT, syncStoredUser);
      window.removeEventListener("storage", syncStoredUser);
    };
  }, []);
  const loadNotifications = useCallback(async () => {
    if (!showNotifications) return;
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const response = await fetchUserNotifications(20);
      setNotifications(response.items);
      setUnreadNotificationsCount(response.unread_count);
    } catch {
      setNotificationsError("Unable to load notifications.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [showNotifications]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!showNotifications || unreadNotificationsCount <= 0) return;
    setNotificationsError(null);
    try {
      const response = await markUserNotificationsRead({ all: true });
      setUnreadNotificationsCount(response.unread_count);
      await loadNotifications();
    } catch (error) {
      console.warn("Unable to mark notifications as read", error);
      setNotificationsError("Unable to mark notifications as read.");
    }
  }, [loadNotifications, showNotifications, unreadNotificationsCount]);

  const adaptiveControlDescriptors = useMemo(
    () => (controlDescriptors?.filter((control) => control.id !== "workspace") ?? []),
    [controlDescriptors]
  );
  const hasAdaptiveControls = adaptiveControlDescriptors.length > 0;
  const inlineControls = useMemo(() => {
    if (!hasAdaptiveControls) {
      return [] as { id: TopbarControlDescriptor["id"]; mode: "icon" | "icon_label"; descriptor: TopbarControlDescriptor }[];
    }
    const sorted = [...adaptiveControlDescriptors].sort((left, right) => left.priority - right.priority);
    const iconGap = 8;
    const iconOnlyWidth =
      sorted.reduce((sum, item) => sum + item.estimatedIconWidth, 0) + Math.max(0, sorted.length - 1) * iconGap;
    let remainingWidth = Math.max(0, Math.floor(controlsAvailableWidth) - iconOnlyWidth);

    return sorted.map((descriptor) => {
      if (isMobileViewport) {
        return { id: descriptor.id, mode: "icon" as const, descriptor };
      }
      const labelExtraWidth = Math.max(0, descriptor.estimatedLabelWidth - descriptor.estimatedIconWidth);
      if (remainingWidth >= labelExtraWidth) {
        remainingWidth -= labelExtraWidth;
        return { id: descriptor.id, mode: "icon_label" as const, descriptor };
      }
      return { id: descriptor.id, mode: "icon" as const, descriptor };
    });
  }, [adaptiveControlDescriptors, controlsAvailableWidth, hasAdaptiveControls, isMobileViewport]);

  const workspaceOptions = useMemo(() => workspaceSwitcher?.options ?? [], [workspaceSwitcher]);
  const workspaceSelectedIndex = useMemo(() => {
    if (!workspaceSwitcher) return -1;
    return workspaceOptions.findIndex((option) => option.value === workspaceSwitcher.currentWorkspaceId);
  }, [workspaceOptions, workspaceSwitcher]);

  useEffect(() => {
    if (!showNotifications) return;
    void loadNotifications();
    const interval = window.setInterval(() => {
      void loadNotifications();
    }, 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadNotifications, showNotifications]);

  useEffect(() => {
    if (!notificationsOpen) return;
    void loadNotifications();
  }, [loadNotifications, notificationsOpen]);

  useEffect(() => {
    if (!hasAdaptiveControls) return;
    const target = controlsStripRef.current;
    if (!target) return;

    const update = () => {
      const width = target.getBoundingClientRect().width;
      if (width > 0) {
        setControlsAvailableWidth(Math.floor(width));
      }
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        update();
      });
      observer.observe(target);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, [hasAdaptiveControls]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    setWorkspaceActiveIndex(workspaceSelectedIndex >= 0 ? workspaceSelectedIndex : workspaceOptions.length > 0 ? 0 : -1);
    requestAnimationFrame(() => {
      workspaceListboxRef.current?.focus();
    });
  }, [workspaceMenuOpen, workspaceOptions.length, workspaceSelectedIndex]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    if (workspaceOptions.length === 0) {
      setWorkspaceActiveIndex(-1);
      return;
    }
    if (workspaceActiveIndex < 0 || workspaceActiveIndex >= workspaceOptions.length) {
      setWorkspaceActiveIndex(0);
    }
  }, [workspaceActiveIndex, workspaceMenuOpen, workspaceOptions.length]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const queryMenuItems = () =>
      Array.from(accountMenuSurfaceRef.current?.querySelectorAll<HTMLButtonElement>("[data-account-menu-item='true']") ?? []);

    const focusMenuItem = (index: number) => {
      const items = queryMenuItems();
      if (items.length === 0) return;
      const normalizedIndex = (index + items.length) % items.length;
      items[normalizedIndex].focus();
    };

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setAccountMenuOpen(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const activeElement = document.activeElement as HTMLElement | null;
      const items = queryMenuItems();
      if (items.length === 0) return;
      const currentIndex = activeElement ? items.findIndex((item) => item === activeElement) : -1;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMenuItem(currentIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMenuItem(currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        focusMenuItem(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        focusMenuItem(items.length - 1);
      }
    };

    requestAnimationFrame(() => {
      focusMenuItem(0);
    });

    document.addEventListener("keydown", handleMenuKeyDown);
    return () => {
      document.removeEventListener("keydown", handleMenuKeyDown);
    };
  }, [accountMenuOpen]);

  const triggerLogout = () => {
    setAccountMenuOpen(false);
    onLogout?.();
  };

  const activateWorkspaceByIndex = (index: number) => {
    if (!workspaceSwitcher) return;
    if (index < 0 || index >= workspaceOptions.length) return;
    const option = workspaceOptions[index];
    setWorkspaceMenuOpen(false);
    if (option.value !== workspaceSwitcher.currentWorkspaceId) {
      workspaceSwitcher.onChange(option.value);
    }
    workspaceTriggerRef.current?.focus();
  };

  const handleWorkspaceListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setWorkspaceMenuOpen(false);
      workspaceTriggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setWorkspaceMenuOpen(false);
      return;
    }
    if (workspaceOptions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setWorkspaceActiveIndex((current) => (current < 0 ? 0 : (current + 1) % workspaceOptions.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setWorkspaceActiveIndex((current) =>
        current < 0 ? workspaceOptions.length - 1 : (current - 1 + workspaceOptions.length) % workspaceOptions.length
      );
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setWorkspaceActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setWorkspaceActiveIndex(workspaceOptions.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (workspaceActiveIndex >= 0) activateWorkspaceByIndex(workspaceActiveIndex);
    }
  };

  const workspaceTriggerLabel = workspaceSwitcher
    ? compactWorkspaceLabel(workspaceSwitcher.currentWorkspaceLabel)
    : compactWorkspaceLabel(section);
  const showWorkspaceInTopbar = showWorkspaceSwitcher;

  const renderWorkspaceSelector = (placement: "sidebar" | "topbar") => {
    const sidebarPlacement = placement === "sidebar";

    if (workspaceSwitcher) {
      return (
        <div className="relative min-w-0 shrink-0">
          <button
            ref={workspaceTriggerRef}
            type="button"
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
            aria-label="Switch workspace"
            aria-haspopup="listbox"
            aria-expanded={workspaceMenuOpen}
            aria-controls={workspaceMenuOpen ? workspaceListboxId : undefined}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              setWorkspaceMenuOpen(true);
            }}
            className={`shell-control inline-flex min-w-0 items-center rounded-lg border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
              sidebarPlacement
                ? "h-10 w-full px-3"
                : "h-10 w-[140px] px-3"
            } ${workspaceMenuOpen ? "shell-control-active" : ""}`}
          >
            <span className="min-w-0 flex-1 leading-tight">
              <span className="shell-muted-text block truncate text-[10px] font-medium">Workspace</span>
              <span className="mt-0.5 block truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]">
                {workspaceTriggerLabel}
              </span>
            </span>
            <ChevronDownIcon
              className={`shell-icon-muted ml-2 h-4 w-4 shrink-0 transition-transform ${
                workspaceMenuOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {workspaceMenuOpen && (
            <AnchoredPortalMenu
              open={workspaceMenuOpen}
              anchorRef={workspaceTriggerRef}
              placement="bottom-start"
              minWidth={240}
              className="shell-menu overflow-hidden rounded-lg border p-1.5"
            >
              <div ref={workspaceMenuSurfaceRef}>
                <div
                  id={workspaceListboxId}
                  ref={workspaceListboxRef}
                  className="max-h-72 overflow-y-auto focus:outline-none"
                  role="listbox"
                  tabIndex={0}
                  aria-label="Switch workspace"
                  aria-activedescendant={
                    workspaceActiveIndex >= 0 ? `${workspaceListboxId}-option-${workspaceActiveIndex}` : undefined
                  }
                  onKeyDown={handleWorkspaceListboxKeyDown}
                >
                  {workspaceOptions.map((option, index) => {
                    const active = workspaceSwitcher.currentWorkspaceId === option.value;
                    const highlighted = workspaceOptions[workspaceActiveIndex]?.value === option.value;
                    return (
                      <button
                        key={option.value}
                        id={`${workspaceListboxId}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        tabIndex={-1}
                        onMouseEnter={() => setWorkspaceActiveIndex(index)}
                        onClick={() => activateWorkspaceByIndex(index)}
                        className={`flex w-full items-start gap-2 rounded-md px-3 py-1.5 text-left transition ${
                          active
                            ? "shell-menu-item-active"
                            : highlighted
                              ? "shell-menu-item-highlighted"
                              : "shell-menu-item hover:bg-[var(--shell-hover)]"
                        }`}
                      >
                        <span className="mt-0.5 h-4 w-4 shrink-0">
                          {active ? <CheckIcon className="h-4 w-4" /> : null}
                        </span>
                        {option.icon && (
                          <span className="shell-icon-muted mt-0.5 h-4 w-4 shrink-0">{option.icon}</span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate ui-caption font-semibold">{option.label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </AnchoredPortalMenu>
          )}
        </div>
      );
    }

    return (
      <div className={`shell-control flex min-w-0 items-center gap-2 rounded-lg border ${sidebarPlacement ? "h-10 px-3" : "h-10 w-[140px] px-3"}`}>
        <span className="min-w-0 leading-[1.05]">
          <span className="shell-muted-text block truncate text-[10px] font-medium">Workspace</span>
          {workspaceTriggerLabel && (
            <span className="mt-0.5 block truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]">
              {workspaceTriggerLabel}
            </span>
          )}
        </span>
      </div>
    );
  };

  const renderNotificationItem = (item: UserNotification) => {
    const payload = item.payload ?? {};
    const checkedAt = formatDateTime((payload.checked_at as string | undefined) ?? item.created_at);
    const ratio = formatPercent(payload.usage_ratio_pct);
    const usedBytes = formatBytes(payload.used_bytes);
    const quotaBytes = formatBytes(payload.quota_size_bytes);
    const usedObjects = formatCount(payload.used_objects);
    const quotaObjects = formatCount(payload.quota_objects);
    const endpointName = typeof payload.endpoint_name === "string" ? payload.endpoint_name : null;
    const severityLabel = item.severity === "error" ? "Error" : item.severity === "warning" ? "Warning" : "Info";
    const severityClass =
      item.severity === "error"
        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-700/70 dark:bg-red-950/30 dark:text-red-200"
        : item.severity === "warning"
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-200"
          : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700/70 dark:bg-blue-950/30 dark:text-blue-200";
    return (
      <li
        key={item.id}
        className={`rounded-md border px-3 py-2 ${
          item.read_at ? "border-[color:var(--shell-border-soft)]" : "border-[color:var(--shell-border)] bg-[var(--shell-hover)]"
        }`}
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate ui-caption font-semibold text-[var(--shell-text)]">{item.title}</p>
            <p className="mt-0.5 ui-caption text-[var(--shell-text)]">{item.message}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${severityClass}`}>
            {severityLabel}
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 ui-caption text-[var(--shell-muted)]">
          {ratio && (
            <>
              <dt>Usage</dt>
              <dd className="text-right font-semibold text-[var(--shell-text)]">{ratio}</dd>
            </>
          )}
          {usedBytes && (
            <>
              <dt>Storage</dt>
              <dd className="text-right text-[var(--shell-text)]">
                {usedBytes}
                {quotaBytes ? ` / ${quotaBytes}` : ""}
              </dd>
            </>
          )}
          {usedObjects && (
            <>
              <dt>Objects</dt>
              <dd className="text-right text-[var(--shell-text)]">
                {usedObjects}
                {quotaObjects ? ` / ${quotaObjects}` : ""}
              </dd>
            </>
          )}
          {endpointName && (
            <>
              <dt>Endpoint</dt>
              <dd className="truncate text-right text-[var(--shell-text)]">{endpointName}</dd>
            </>
          )}
          {checkedAt && (
            <>
              <dt>Checked</dt>
              <dd className="text-right text-[var(--shell-text)]">{checkedAt}</dd>
            </>
          )}
        </dl>
      </li>
    );
  };

  return (
    <>
      <div
        data-topbar
        className="shell-topbar z-[45] shrink-0"
      >
        <div className="flex h-14 min-w-0 items-center gap-2.5 px-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {showMobileMenuButton && (
              <button
                type="button"
                onClick={onMobileMenuToggle}
                aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
                aria-controls="mobile-navigation-panel"
                aria-expanded={mobileMenuOpen}
                className="shell-control inline-flex h-9 w-9 items-center justify-center rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 md:hidden"
              >
                <HamburgerIcon className="h-4 w-4" />
              </button>
            )}

            {showWorkspaceInTopbar ? renderWorkspaceSelector("topbar") : null}

            {hasAdaptiveControls ? (
              <div ref={controlsStripRef} className="flex min-w-0 flex-1 items-center">
                <div className="flex min-w-0 items-center gap-2">
                  {inlineControls.map((entry) => {
                    return <div key={entry.id}>{entry.descriptor.renderControl(entry.mode)}</div>;
                  })}
                </div>
              </div>
            ) : (
              controlsContent && <div className="hidden min-w-0 items-center md:flex">{controlsContent}</div>
            )}
          </div>

          {inlineContent && <div className="hidden min-w-0 items-center pl-1 xl:flex">{inlineContent}</div>}

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {contextAction && <div className="hidden sm:flex">{contextAction}</div>}

            <ThemeToggle />

            {showNotifications && (
              <div ref={notificationsRootRef} className="relative">
                <button
                  ref={notificationsTriggerRef}
                  type="button"
                  onClick={() => setNotificationsOpen((open) => !open)}
                  aria-label="Notifications"
                  aria-haspopup="menu"
                  aria-expanded={notificationsOpen}
                  aria-controls={notificationsOpen ? notificationsMenuId : undefined}
                  className={`shell-control relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
                    notificationsOpen ? "shell-control-active" : ""
                  }`}
                >
                  <BellIcon className="h-4 w-4" />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
                      {unreadNotificationsCount > 9 ? "9+" : unreadNotificationsCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <AnchoredPortalMenu
                    open={notificationsOpen}
                    anchorRef={notificationsTriggerRef}
                    placement="bottom-end"
                    minWidth={360}
                    className="shell-menu w-[22.5rem] max-w-[calc(100vw-1.5rem)] rounded-lg border p-0"
                  >
                    <div
                      id={notificationsMenuId}
                      ref={notificationsSurfaceRef}
                      role="menu"
                      aria-label="Notifications"
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--shell-border-soft)] px-3 py-2">
                        <div>
                          <p className="ui-caption font-semibold text-[var(--shell-text)]">Notifications</p>
                          <p className="shell-muted-text ui-caption">{unreadNotificationsCount} unread</p>
                        </div>
                        <button
                          type="button"
                          onClick={markAllNotificationsRead}
                          disabled={unreadNotificationsCount <= 0}
                          className="rounded-md px-2 py-1 ui-caption font-semibold text-primary-700 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-primary-200 dark:hover:bg-white/[0.06]"
                        >
                          Mark all as read
                        </button>
                      </div>

                      <div className="max-h-[28rem] overflow-y-auto p-2">
                        {notificationsError && (
                          <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 ui-caption text-red-700 dark:border-red-800/70 dark:bg-red-950/30 dark:text-red-200">
                            {notificationsError}
                          </div>
                        )}
                        {notificationsLoading && notifications.length === 0 ? (
                          <div className="rounded-md border border-[color:var(--shell-border-soft)] px-3 py-6 text-center ui-caption text-[var(--shell-muted)]">
                            Loading notifications...
                          </div>
                        ) : notifications.length === 0 ? (
                          <div className="rounded-md border border-[color:var(--shell-border-soft)] px-3 py-6 text-center ui-caption text-[var(--shell-muted)]">
                            No notifications.
                          </div>
                        ) : (
                          <ul className="space-y-2">{notifications.map(renderNotificationItem)}</ul>
                        )}
                      </div>
                    </div>
                  </AnchoredPortalMenu>
                )}
              </div>
            )}

            <div ref={accountMenuRootRef} className="relative">
              <button
                ref={accountMenuTriggerRef}
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-label={`Account actions for ${accountDisplay}`}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-controls={accountMenuOpen ? accountMenuId : undefined}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  setAccountMenuOpen(true);
                }}
                className="inline-flex h-9 items-center gap-0 rounded-lg border border-transparent bg-transparent px-1 text-left transition hover:bg-[var(--shell-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:gap-2 sm:px-1.5"
              >
                <UserAvatar
                  avatar={storedUser?.avatar}
                  name={accountAvatarName}
                  email={accountDisplay}
                  size="md"
                  className="border-[var(--shell-surface)] shadow-none"
                />
                <span className="hidden min-w-0 max-w-40 truncate text-[12px] font-semibold text-[var(--shell-text)] sm:block lg:max-w-52">
                  {accountDisplay}
                </span>
                <ChevronDownIcon
                  className={`shell-icon-muted hidden h-4 w-4 transition-transform sm:block ${
                    accountMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {accountMenuOpen && (
                <AnchoredPortalMenu open={accountMenuOpen} anchorRef={accountMenuTriggerRef} placement="bottom-end" minWidth={288}>
                  <div
                    id={accountMenuId}
                    ref={accountMenuSurfaceRef}
                    role="menu"
                    aria-label="Account actions"
                    className="shell-menu w-72 rounded-lg border p-1.5"
                  >
                    <div className="shell-menu-muted mb-1 flex items-center gap-2.5 rounded-md border px-2.5 py-2">
                      <UserAvatar
                        avatar={storedUser?.avatar}
                        name={accountAvatarName}
                        email={accountDisplay}
                        size="lg"
                        className="border-[var(--shell-surface)] shadow-none"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="shell-muted-text ui-caption">Signed in as</p>
                        <p className="truncate ui-caption font-semibold text-[var(--shell-text)]">{accountName}</p>
                        {accountName !== accountDisplay ? (
                          <p className="shell-muted-text truncate ui-caption">{accountDisplay}</p>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <span className="shell-menu-muted inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold text-[var(--shell-text)]">
                            {uiRoleLabel}
                          </span>
                        </div>
                      </div>
                    </div>

                    <a
                      href={`${profilePath}?tab=profile`}
                      role="menuitem"
                      data-account-menu-item="true"
                      onClick={() => setAccountMenuOpen(false)}
                      className="shell-menu-item flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition"
                    >
                      <UserIcon className="shell-icon-muted mt-0.5 h-4 w-4" />
                      <span>
                        <span className="block ui-caption font-semibold text-[var(--shell-text)]">
                          User profile
                        </span>
                        <span className="shell-muted-text block ui-caption">
                          Personal details and preferences
                        </span>
                      </span>
                    </a>

                    {canAccessPrivateConnections && (
                      <a
                        href={`${profilePath}?tab=connections`}
                        role="menuitem"
                        data-account-menu-item="true"
                        onClick={() => setAccountMenuOpen(false)}
                        className="shell-menu-item flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition"
                      >
                        <LinkIcon className="shell-icon-muted mt-0.5 h-4 w-4" />
                        <span>
                          <span className="block ui-caption font-semibold text-[var(--shell-text)]">
                            Private S3 connections
                          </span>
                          <span className="shell-muted-text block ui-caption">
                            Manage your endpoints and credentials
                          </span>
                        </span>
                      </a>
                    )}

                    <div className="my-1 border-t border-[color:var(--shell-border-soft)]" />
                    <button
                      type="button"
                      role="menuitem"
                      data-account-menu-item="true"
                      onClick={triggerLogout}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left ui-caption font-semibold text-primary-700 transition hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-white/[0.06]"
                    >
                      <LogoutIcon className="h-4 w-4" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </AnchoredPortalMenu>
              )}
            </div>
          </div>
        </div>
      </div>

    </>
  );
}

function HamburgerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m5 7 5 6 5-6" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m4.5 10.5 3.2 3.2 7.8-7.8" />
    </svg>
  );
}

function UserIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="8" r="3.25" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M5 19a7 7 0 0 1 14 0" />
    </svg>
  );
}

function LinkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 14a4 4 0 0 1 0-5.66L12.34 6a4 4 0 0 1 5.66 5.66L16.5 13.2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 10a4 4 0 0 1 0 5.66L11.66 18a4 4 0 0 1-5.66-5.66L7.5 10.8" />
    </svg>
  );
}

function BellIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M18 9.5a6 6 0 1 0-12 0c0 6-2.25 6.5-2.25 6.5h16.5S18 15.5 18 9.5Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 19a2.25 2.25 0 0 0 4.5 0" />
    </svg>
  );
}

function LogoutIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 16.5 20 12l-5-4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 12H9" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5h6" />
    </svg>
  );
}
