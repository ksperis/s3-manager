/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type KeyboardEvent as ReactKeyboardEvent, ReactNode, Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from "react";
import { isAdminLikeRole, isSuperAdminRole, readStoredUser } from "../utils/workspaces";
import type { WorkspaceSwitcherModel } from "./EnvironmentSwitcher";
import { useGeneralSettings } from "./GeneralSettingsContext";
import Modal from "./Modal";
import ThemeToggle from "./ThemeToggle";
import type { TopbarControlDescriptor } from "./topbarControlsLayout";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

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
};

type StoredAccountLink = {
  account_id: number;
  account_admin?: boolean | null;
};

type StoredTopbarUser = {
  role?: string | null;
  authType?: "password" | "s3_session" | "oidc" | "ldap" | null;
  account_links?: StoredAccountLink[] | null;
};

const ProfilePage = lazy(() => import("../features/shared/ProfilePage"));
const ApiTokensPage = lazy(() => import("../features/admin/ApiTokensPage"));

function buildAccountInitial(value?: string | null): string {
  if (!value) return "U";
  const clean = value.trim().replace(/[^a-zA-Z0-9]/g, "");
  if (!clean) return "U";
  return clean[0].toUpperCase();
}

function resolveUiRoleLabel(user: StoredTopbarUser | null): string {
  if (!user) return "Unknown";
  if (user.authType === "s3_session") return "S3 Session";
  const role = (user.role ?? "").trim().toLowerCase();
  if (role === "ui_superadmin" || role === "super_admin" || role === "superadmin") return "Superadmin";
  if (role === "ui_admin" || role === "admin") return "Admin";
  if (role === "ui_user" || role === "user") return "User";
  if (role === "ui_none" || role === "none") return "No access";
  return "Unknown";
}

function compactWorkspaceLabel(label?: string | null): string {
  const normalized = (label ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!normalized) return "Workspace";
  if (normalized.toLowerCase() === "administration") return "Admin";
  return normalized;
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
}: TopbarProps) {
  const { generalSettings } = useGeneralSettings();
  const storedUser = useMemo(() => readStoredUser() as StoredTopbarUser | null, []);
  const isS3Session = storedUser?.authType === "s3_session";
  const canManagePrivateConnections =
    !isS3Session &&
    (isAdminLikeRole(storedUser?.role) ||
      (storedUser?.role === "ui_user" && generalSettings.allow_user_private_connections));
  const canManageApiTokens = !isS3Session && isSuperAdminRole(storedUser?.role);
  const uiRoleLabel = useMemo(() => resolveUiRoleLabel(storedUser), [storedUser]);

  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  const [controlsAvailableWidth, setControlsAvailableWidth] = useState<number>(Number.POSITIVE_INFINITY);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileModalHasUnsavedChanges, setProfileModalHasUnsavedChanges] = useState(false);
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const [showApiTokensModal, setShowApiTokensModal] = useState(false);
  const accountMenuRootRef = useRef<HTMLDivElement | null>(null);
  const accountMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const accountMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuId = useId();

  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceActiveIndex, setWorkspaceActiveIndex] = useState(-1);
  const workspaceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceListboxRef = useRef<HTMLDivElement | null>(null);
  const workspaceListboxId = useId();

  const controlsStripRef = useRef<HTMLDivElement | null>(null);

  const accountDisplay = userEmail ?? "Session";
  const accountInitial = buildAccountInitial(accountDisplay);
  const closeProfileModal = () => {
    setShowProfileModal(false);
    setProfileModalHasUnsavedChanges(false);
  };
  const profileCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showProfileModal && profileModalHasUnsavedChanges,
    onClose: closeProfileModal,
    zIndexClass: "z-[70]",
  });

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
    if (typeof window === "undefined") return;
    const updateViewport = () => {
      setIsMobileViewport(window.innerWidth < 768);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    };
  }, []);

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

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (workspaceTriggerRef.current?.contains(target)) return;
      if (workspaceMenuSurfaceRef.current?.contains(target)) return;
      setWorkspaceMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setWorkspaceMenuOpen(false);
      workspaceTriggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [workspaceMenuOpen]);

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

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (accountMenuRootRef.current?.contains(target)) return;
      if (accountMenuSurfaceRef.current?.contains(target)) return;
      setAccountMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAccountMenuOpen(false);
        accountMenuTriggerRef.current?.focus();
        return;
      }
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

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [accountMenuOpen]);

  const openProfileModal = () => {
    setAccountMenuOpen(false);
    setProfileModalHasUnsavedChanges(false);
    setShowProfileModal(true);
  };

  const openConnectionsModal = () => {
    setAccountMenuOpen(false);
    setShowConnectionsModal(true);
  };

  const openApiTokensModal = () => {
    setAccountMenuOpen(false);
    setShowApiTokensModal(true);
  };

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
            className={`shell-control inline-flex min-w-0 items-center rounded-lg border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
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

  return (
    <>
      <div
        data-topbar
        className="shell-topbar z-[45] shrink-0 border-b shadow-[0_1px_0_rgba(15,23,42,0.02)]"
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
                className="shell-control inline-flex h-9 w-9 items-center justify-center rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:hidden"
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

            <button
              type="button"
              aria-label="Search"
              title="Search"
              className="shell-icon-button inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent bg-transparent transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <SearchIcon className="h-4 w-4" />
            </button>

            <ThemeToggle />

            <div ref={accountMenuRootRef} className="relative">
              <button
                ref={accountMenuTriggerRef}
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-controls={accountMenuOpen ? accountMenuId : undefined}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  setAccountMenuOpen(true);
                }}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-transparent bg-transparent px-1.5 text-left transition hover:bg-[var(--shell-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-[12px] font-semibold text-primary-700 dark:bg-primary-900/45 dark:text-primary-100">
                  {accountInitial}
                </span>
                <span className="hidden min-w-0 max-w-40 truncate text-[12px] font-semibold text-[var(--shell-text)] sm:block lg:max-w-52">
                  {accountDisplay}
                </span>
                <ChevronDownIcon
                  className={`shell-icon-muted h-4 w-4 transition-transform ${
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
                    <div className="shell-menu-muted mb-1 rounded-md border px-2.5 py-2">
                      <p className="shell-muted-text ui-caption">Signed in as</p>
                      <p className="truncate ui-caption font-semibold text-[var(--shell-text)]">{accountDisplay}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className="shell-menu-muted inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold text-[var(--shell-text)]">
                          {uiRoleLabel}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      data-account-menu-item="true"
                      onClick={openProfileModal}
                      className="shell-menu-item flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition"
                    >
                      <UserIcon className="shell-icon-muted mt-0.5 h-4 w-4" />
                      <span>
                        <span className="block ui-caption font-semibold text-[var(--shell-text)]">
                          User profile
                        </span>
                        <span className="shell-muted-text block ui-caption">
                          Identity, password, preferences
                        </span>
                      </span>
                    </button>

                    {canManagePrivateConnections && (
                      <button
                        type="button"
                        role="menuitem"
                        data-account-menu-item="true"
                        onClick={openConnectionsModal}
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
                      </button>
                    )}

                    {canManageApiTokens && (
                      <button
                        type="button"
                        role="menuitem"
                        data-account-menu-item="true"
                        onClick={openApiTokensModal}
                        className="shell-menu-item flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition"
                      >
                        <ApiKeyIcon className="shell-icon-muted mt-0.5 h-4 w-4" />
                        <span>
                          <span className="block ui-caption font-semibold text-[var(--shell-text)]">
                            API tokens
                          </span>
                          <span className="shell-muted-text block ui-caption">
                            Manage admin automation tokens
                          </span>
                        </span>
                      </button>
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

      {showProfileModal && (
        <Modal
          title="User profile"
          onClose={profileCloseGuard.requestClose}
          maxWidthClass="max-w-6xl"
          maxBodyHeightClass="max-h-[85vh]"
          zIndexClass="z-[46]"
        >
          <Suspense fallback={<div className="ui-caption text-slate-500 dark:text-slate-400">Loading profile...</div>}>
            <ProfilePage
              showPageHeader={false}
              showSettingsCards
              showConnectionsSection={false}
              onUnsavedChangesChange={setProfileModalHasUnsavedChanges}
            />
          </Suspense>
          {profileCloseGuard.confirmationDialog}
        </Modal>
      )}

      {showConnectionsModal && (
        <Modal
          title="Private S3 connections"
          onClose={() => setShowConnectionsModal(false)}
          maxWidthClass="max-w-7xl"
          maxBodyHeightClass="max-h-[85vh]"
          zIndexClass="z-[46]"
        >
          <Suspense fallback={<div className="ui-caption text-slate-500 dark:text-slate-400">Loading profile...</div>}>
            <ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />
          </Suspense>
        </Modal>
      )}

      {showApiTokensModal && (
        <Modal
          title="API tokens"
          onClose={() => setShowApiTokensModal(false)}
          maxWidthClass="max-w-7xl"
          maxBodyHeightClass="max-h-[85vh]"
          zIndexClass="z-[46]"
        >
          <Suspense fallback={<div className="ui-caption text-slate-500 dark:text-slate-400">Loading API tokens...</div>}>
            <ApiTokensPage showPageHeader={false} />
          </Suspense>
        </Modal>
      )}
    </>
  );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="11" cy="11" r="6.5" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeWidth={1.7} d="m16 16 4.5 4.5" />
    </svg>
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

function ApiKeyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="8.5" cy="12" r="3" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.5 12h9" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 12v-2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.25 12v-2" />
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
