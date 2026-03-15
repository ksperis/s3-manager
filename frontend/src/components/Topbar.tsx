/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type KeyboardEvent as ReactKeyboardEvent, ReactNode, Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from "react";
import { isAdminLikeRole, readStoredUser } from "../utils/workspaces";
import { useWorkspaceSwitcherModel } from "./EnvironmentSwitcher";
import { useGeneralSettings } from "./GeneralSettingsContext";
import Modal from "./Modal";
import ThemeToggle from "./ThemeToggle";
import type { TopbarControlDescriptor } from "./topbarControlsLayout";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";

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
};

type StoredAccountLink = {
  account_id: number;
  account_admin?: boolean | null;
};

type StoredTopbarUser = {
  role?: string | null;
  authType?: "password" | "s3_session" | "oidc" | null;
  account_links?: StoredAccountLink[] | null;
};

const ProfilePage = lazy(() => import("../features/shared/ProfilePage"));

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

export default function Topbar({
  projectName,
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
}: TopbarProps) {
  const { generalSettings } = useGeneralSettings();
  const storedUser = useMemo(() => readStoredUser() as StoredTopbarUser | null, []);
  const workspaceSwitcher = useWorkspaceSwitcherModel();
  const isS3Session = storedUser?.authType === "s3_session";
  const canManagePrivateConnections =
    !isS3Session &&
    (isAdminLikeRole(storedUser?.role) ||
      (storedUser?.role === "ui_user" && generalSettings.allow_user_private_connections));
  const uiRoleLabel = useMemo(() => resolveUiRoleLabel(storedUser), [storedUser]);

  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  const [controlsAvailableWidth, setControlsAvailableWidth] = useState<number>(Number.POSITIVE_INFINITY);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
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
    setShowProfileModal(true);
  };

  const openConnectionsModal = () => {
    setAccountMenuOpen(false);
    setShowConnectionsModal(true);
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

  const projectLabel = projectName ?? "S3 Manager";

  return (
    <>
      <div
        data-topbar
        className="fixed inset-x-0 top-0 z-[45] border-b border-slate-200/80 bg-gradient-to-r from-white/95 via-white/90 to-slate-50/90 shadow-sm backdrop-blur supports-[backdrop-filter]:backdrop-blur dark:border-slate-800 dark:from-slate-900/95 dark:via-slate-900/90 dark:to-slate-950/90"
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {showMobileMenuButton && (
              <button
                type="button"
                onClick={onMobileMenuToggle}
                aria-label={mobileMenuOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
                aria-controls="mobile-navigation-panel"
                aria-expanded={mobileMenuOpen}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-700 shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900 md:hidden"
              >
                <HamburgerIcon className="h-4 w-4" />
              </button>
            )}

            {workspaceSwitcher ? (
              <div className="relative min-w-0 shrink-0">
                <button
                  ref={workspaceTriggerRef}
                  type="button"
                  onClick={() => setWorkspaceMenuOpen((open) => !open)}
                  aria-label="Changer de workspace"
                  aria-haspopup="listbox"
                  aria-expanded={workspaceMenuOpen}
                  aria-controls={workspaceMenuOpen ? workspaceListboxId : undefined}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                    event.preventDefault();
                    setWorkspaceMenuOpen(true);
                  }}
                  className={`inline-flex h-10 min-w-0 items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-2 text-left shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900 ${
                    workspaceMenuOpen ? "border-primary/70" : ""
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
                    <CubeIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 leading-[1.05]">
                    <span className="block truncate ui-caption font-semibold text-slate-900 dark:text-slate-50">{projectLabel}</span>
                    {section && (
                      <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {section}
                      </span>
                    )}
                  </span>
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${
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
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div ref={workspaceMenuSurfaceRef}>
                      <div
                        id={workspaceListboxId}
                        ref={workspaceListboxRef}
                        className="max-h-72 overflow-y-auto focus:outline-none"
                        role="listbox"
                        tabIndex={0}
                        aria-label="Changer de workspace"
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
                              className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition ${
                                active
                                  ? "bg-primary-50 text-primary-900 dark:bg-primary-900/30 dark:text-primary-100"
                                  : highlighted
                                    ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                              }`}
                            >
                              <span className="mt-0.5 h-4 w-4 shrink-0">
                                {active ? <CheckIcon className="h-4 w-4" /> : null}
                              </span>
                              {option.icon && (
                                <span className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-300">{option.icon}</span>
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
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
                  <CubeIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 leading-[1.05]">
                  <span className="block truncate ui-caption font-semibold text-slate-900 dark:text-slate-50">{projectLabel}</span>
                  {section && <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{section}</span>}
                </span>
              </div>
            )}

            {hasAdaptiveControls ? (
              <div ref={controlsStripRef} className="flex min-w-0 flex-1 items-center pl-1">
                <div className="flex min-w-0 items-center gap-2">
                  {inlineControls.map((entry) => {
                    return <div key={entry.id}>{entry.descriptor.renderControl(entry.mode)}</div>;
                  })}
                </div>
              </div>
            ) : (
              controlsContent && <div className="hidden min-w-0 items-center pl-1 md:flex">{controlsContent}</div>
            )}
          </div>

          {inlineContent && <div className="hidden min-w-0 items-center pl-1 xl:flex">{inlineContent}</div>}

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {contextAction && <div className="hidden sm:flex">{contextAction}</div>}

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
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-2 py-1 text-left shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 ui-caption font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                  {accountInitial}
                </span>
                <span className="hidden min-w-0 sm:flex sm:max-w-32 lg:max-w-40 sm:flex-col sm:items-start">
                  <span className="ui-caption uppercase tracking-wide text-slate-400 dark:text-slate-500">Account</span>
                  <span className="w-full truncate ui-caption font-semibold text-slate-700 dark:text-slate-100">
                    {accountDisplay}
                  </span>
                </span>
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 text-slate-500 transition-transform dark:text-slate-300 ${
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
                    className="w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="mb-1 rounded-lg border border-slate-200/70 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
                      <p className="ui-caption text-slate-500 dark:text-slate-400">Signed in as</p>
                      <p className="truncate ui-caption font-semibold text-slate-800 dark:text-slate-100">{accountDisplay}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                          {uiRoleLabel}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      data-account-menu-item="true"
                      onClick={openProfileModal}
                      className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <UserIcon className="mt-0.5 h-4 w-4 text-slate-500 dark:text-slate-300" />
                      <span>
                        <span className="block ui-caption font-semibold text-slate-800 dark:text-slate-100">
                          User profile
                        </span>
                        <span className="block ui-caption text-slate-500 dark:text-slate-400">
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
                        className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <LinkIcon className="mt-0.5 h-4 w-4 text-slate-500 dark:text-slate-300" />
                        <span>
                          <span className="block ui-caption font-semibold text-slate-800 dark:text-slate-100">
                            Private S3 connections
                          </span>
                          <span className="block ui-caption text-slate-500 dark:text-slate-400">
                            Manage your endpoints and credentials
                          </span>
                        </span>
                      </button>
                    )}

                    <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                    <button
                      type="button"
                      role="menuitem"
                      data-account-menu-item="true"
                      onClick={triggerLogout}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ui-caption font-semibold text-primary-700 transition hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-900/40"
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
          onClose={() => setShowProfileModal(false)}
          maxWidthClass="max-w-6xl"
          maxBodyHeightClass="max-h-[85vh]"
          zIndexClass="z-[46]"
        >
          <Suspense fallback={<div className="ui-caption text-slate-500 dark:text-slate-400">Loading profile...</div>}>
            <ProfilePage showPageHeader={false} showSettingsCards showConnectionsSection={false} />
          </Suspense>
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
    </>
  );
}

function CubeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m12 12 8-4.5M12 12 4 7.5M12 12v9" />
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

function LogoutIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 16.5 20 12l-5-4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 12H9" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5h6" />
    </svg>
  );
}
