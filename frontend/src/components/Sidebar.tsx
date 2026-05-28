/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  CSSProperties,
  ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink } from "react-router-dom";
import { SIDEBAR_COMPACT_WIDTH, SIDEBAR_MAX_WIDTH } from "./sidebarSizing";
import { workspaceIconById, type WorkspaceSwitcherModel } from "./EnvironmentSwitcher";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import type { WorkspaceId } from "../utils/workspaces";

export type SidebarLink = {
  to: string;
  label: string;
  badge?: string;
  end?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  icon?: ReactNode;
};

const DEFAULT_DISABLED_HINT = "Unavailable in current context.";

export type SidebarSection = {
  label: string;
  links: SidebarLink[];
  collapsed?: boolean;
  collapsible?: boolean;
};

type SidebarProps = {
  title?: string;
  sections?: SidebarSection[];
  links?: SidebarLink[];
  headerAction?: ReactNode;
  footer?: ReactNode;
  variant?: "desktop" | "mobile";
  className?: string;
  onNavigate?: () => void;
  compact?: boolean;
  width?: number;
  resizing?: boolean;
  onResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onCollapseToggle?: () => void;
  workspaceSwitcher?: WorkspaceSwitcherModel | null;
};

function isSectionCollapsible(section: SidebarSection) {
  return section.collapsible ?? section.label.trim().toLowerCase() === "settings";
}

export default function Sidebar({
  title = "s3-manager",
  sections,
  links = [],
  headerAction,
  footer,
  variant = "desktop",
  className,
  onNavigate,
  compact = false,
  width,
  resizing = false,
  onResizeStart,
  onResizeKeyDown,
  onCollapseToggle,
  workspaceSwitcher,
}: SidebarProps) {
  const workspaceOptions = useMemo(() => workspaceSwitcher?.options ?? [], [workspaceSwitcher]);
  const workspaceSelectedIndex = useMemo(() => {
    if (!workspaceSwitcher) return -1;
    return workspaceOptions.findIndex((option) => option.value === workspaceSwitcher.currentWorkspaceId);
  }, [workspaceOptions, workspaceSwitcher]);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceActiveIndex, setWorkspaceActiveIndex] = useState(-1);
  const workspaceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceListboxRef = useRef<HTMLDivElement | null>(null);
  const workspaceListboxId = useId();
  const effectiveSections: SidebarSection[] = useMemo(
    () => (sections && sections.length > 0 ? sections : [{ label: "Navigation", links }]),
    [links, sections]
  );

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    effectiveSections.forEach((section) => {
      initial[section.label] = isSectionCollapsible(section) ? section.collapsed ?? false : false;
    });
    return initial;
  });

  useEffect(() => {
    setCollapsedSections((previous) => {
      const next: Record<string, boolean> = {};
      effectiveSections.forEach((section) => {
        const collapsible = isSectionCollapsible(section);
        next[section.label] = collapsible ? previous[section.label] ?? section.collapsed ?? false : false;
      });
      return next;
    });
  }, [effectiveSections]);

  const toggleSection = (label: string, collapsible: boolean) => {
    if (!collapsible) return;
    setCollapsedSections((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  };

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

  const baseLinkClasses = compact
    ? "group relative flex h-10 items-center justify-center rounded-md px-2 ui-caption font-semibold leading-4 transition"
    : "group relative flex h-9 items-center justify-between gap-2 overflow-hidden rounded-md px-3 ui-caption font-semibold leading-4 transition";
  const inactiveLinkClasses =
    "text-slate-700 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-50";
  const activeLinkClasses =
    compact
      ? "bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-950/40 dark:text-blue-100"
      : "bg-blue-50 text-blue-700 shadow-sm before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r-full before:bg-blue-600 dark:bg-blue-950/40 dark:text-blue-100 dark:before:bg-blue-300";
  const badgeClasses = "shrink-0 rounded-full px-1.5 py-0.5 ui-caption font-semibold";
  const activeBadgeClasses = "bg-primary-200/80 text-primary-900 dark:bg-primary-800/70 dark:text-primary-100";
  const inactiveBadgeClasses =
    "bg-slate-100 text-slate-600 group-hover:bg-slate-200/90 group-hover:text-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-700 dark:group-hover:text-slate-100";
  const containerClasses =
    variant === "desktop"
      ? `relative hidden h-full shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 md:flex md:flex-col ${
          compact ? "px-2" : "px-0"
        } ${resizing ? "" : "transition-[width,padding] duration-200 ease-out"}`
      : "flex h-full flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950";
  const rootClassName = className ? `${containerClasses} ${className}` : containerClasses;
  const iconClasses = compact ? "h-4 w-4" : "h-3.5 w-3.5";
  const currentWorkspaceLabel = workspaceSwitcher?.currentWorkspaceLabel ?? title;
  const rootStyle: CSSProperties | undefined =
    variant === "desktop" && width
      ? {
          width: `${width}px`,
        }
      : undefined;

  return (
    <aside className={rootClassName} style={rootStyle} data-sidebar-variant={variant}>
      <div className={`relative border-b border-slate-200 dark:border-slate-800 ${compact ? "px-0 py-3" : "px-4 py-4"}`}>
        {workspaceSwitcher ? (
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
            className={`flex w-full min-w-0 items-center rounded-lg text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-900 ${
              compact ? "justify-center p-1" : "gap-3 p-1.5"
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-200 dark:shadow-black/20">
              <SidebarCompassIcon className="h-5 w-5" />
            </span>
            {!compact && (
              <>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-bold text-slate-950 dark:text-slate-50">S3 Manager</span>
                  <span className="mt-0.5 block truncate text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    {currentWorkspaceLabel}
                  </span>
                </span>
                <SidebarChevronDownIcon
                  className={`h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${
                    workspaceMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </>
            )}
          </button>
        ) : (
          <div className={`flex min-w-0 items-center ${compact ? "justify-center" : "gap-3"}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-200 dark:shadow-black/20">
              <SidebarCompassIcon className="h-5 w-5" />
            </div>
            {!compact && (
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[13px] font-bold text-slate-950 dark:text-slate-50">S3 Manager</p>
                <p className="mt-0.5 truncate text-[12px] font-medium text-slate-500 dark:text-slate-400">{title}</p>
              </div>
            )}
          </div>
        )}
        {workspaceMenuOpen && workspaceSwitcher && (
          <AnchoredPortalMenu
            open={workspaceMenuOpen}
            anchorRef={workspaceTriggerRef}
            placement="bottom-start"
            minWidth={compact ? 220 : "anchor"}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
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
                      className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition ${
                        active
                          ? "bg-blue-50 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100"
                          : highlighted
                            ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="mt-0.5 h-4 w-4 shrink-0">{active ? <CheckIcon className="h-4 w-4" /> : null}</span>
                      <span className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-300">
                        {workspaceIconById(option.value as WorkspaceId)}
                      </span>
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
        {!compact && headerAction ? <div className="mt-3">{headerAction}</div> : null}
      </div>

      <nav
        className={`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-5 ${compact ? "px-0" : "px-4"}`}
        aria-label={`${title} navigation`}
      >
        {effectiveSections.map((section) => {
          const collapsible = isSectionCollapsible(section);
          const isCollapsed = compact ? false : collapsedSections[section.label];
          return (
            <section
              key={section.label}
              className="space-y-1.5"
            >
              {compact ? (
                <div className="mx-auto my-1 h-1.5 w-7 rounded-full bg-slate-200 dark:bg-slate-700" />
              ) : collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleSection(section.label, collapsible)}
                  className="flex h-6 w-full items-center justify-between rounded-md px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                >
                  <span>{section.label}</span>
                  <SidebarChevronIcon className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                </button>
              ) : (
                <div className="px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  {section.label}
                </div>
              )}
              {!isCollapsed && (
                <ul className="space-y-0.5">
                  {section.links.map((link) => (
                    <li key={link.to}>
                      {link.disabled ? (
                        <div
                          className={`${baseLinkClasses} ${inactiveLinkClasses} cursor-not-allowed opacity-50`}
                          aria-disabled="true"
                          aria-label={compact ? link.label : undefined}
                          title={link.disabledHint ?? DEFAULT_DISABLED_HINT}
                        >
                          <div className={`flex min-w-0 items-center ${compact ? "" : "gap-2"}`}>
                            <span className={`shrink-0 text-slate-500 dark:text-slate-400 ${iconClasses}`}>
                              {link.icon ?? resolveSidebarLinkIcon(link)}
                            </span>
                            {!compact && <span className="truncate">{link.label}</span>}
                          </div>
                          {!compact && link.badge && (
                            <span className={`${badgeClasses} ${inactiveBadgeClasses}`}>{link.badge}</span>
                          )}
                        </div>
                      ) : (
                        <NavLink
                          to={link.to}
                          end={link.end}
                          onClick={onNavigate}
                          aria-label={compact ? link.label : undefined}
                          title={compact ? link.label : undefined}
                          className={({ isActive }) =>
                            [baseLinkClasses, isActive ? activeLinkClasses : inactiveLinkClasses].join(" ")
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <div className={`flex min-w-0 items-center ${compact ? "" : "gap-2"}`}>
                                <span
                                  className={`shrink-0 ${
                                    isActive
                                      ? "text-primary-700 dark:text-primary-200"
                                      : "text-slate-500 dark:text-slate-400"
                                  } ${iconClasses}`}
                                >
                                  {link.icon ?? resolveSidebarLinkIcon(link)}
                                </span>
                                {!compact && <span className="truncate">{link.label}</span>}
                              </div>
                              {!compact && link.badge && (
                                <span className={`${badgeClasses} ${isActive ? activeBadgeClasses : inactiveBadgeClasses}`}>
                                  {link.badge}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </nav>
      {footer ? <div className={`shrink-0 overflow-hidden border-t border-slate-200 dark:border-slate-800 ${compact ? "p-2" : "p-4"}`}>{footer}</div> : null}
      {variant === "desktop" && onCollapseToggle ? (
        <div className={`shrink-0 border-t border-slate-200 dark:border-slate-800 ${compact ? "p-2" : "p-4"}`}>
          <button
            type="button"
            onClick={onCollapseToggle}
            aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
            title={compact ? "Expand" : undefined}
            className={`flex h-9 w-full items-center rounded-md text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-50 ${
              compact ? "justify-center px-2" : "gap-2 px-3"
            }`}
          >
            <CollapseIcon className={`h-4 w-4 shrink-0 transition-transform ${compact ? "rotate-180" : ""}`} />
            {!compact && <span>Collapse</span>}
          </button>
        </div>
      ) : null}
      {variant === "desktop" && onResizeStart && onResizeKeyDown ? (
        <div className="absolute inset-y-0 right-0 flex w-4 translate-x-1/2 items-center justify-center">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={SIDEBAR_COMPACT_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={onResizeStart}
            onKeyDown={onResizeKeyDown}
            className="group flex h-full w-4 cursor-col-resize touch-none items-center justify-center outline-none focus-visible:rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span
              className={`block h-24 w-[3px] rounded-full transition ${
                resizing
                  ? "bg-primary shadow-[0_0_0_6px_rgba(14,165,233,0.14)] dark:shadow-[0_0_0_6px_rgba(56,189,248,0.14)]"
                  : "bg-slate-300/90 group-hover:bg-primary/70 group-focus-visible:bg-primary/80 dark:bg-slate-600/90 dark:group-hover:bg-primary-300/80 dark:group-focus-visible:bg-primary-300"
              }`}
            />
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function SidebarCompassIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="8.5" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M14.6 9.4 13 13l-3.6 1.6L11 11l3.6-1.6Z" />
    </svg>
  );
}

function SidebarChevronIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m7 5 6 5-6 5" />
    </svg>
  );
}

function SidebarChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
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

function CollapseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m12 5-5 5 5 5" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M15 4.5v11" />
    </svg>
  );
}

function resolveSidebarLinkIcon(link: SidebarLink) {
  const key = `${link.label} ${link.to}`.toLowerCase();
  if (key.includes("dashboard") || key.includes("home")) return <NavHomeIcon />;
  if (key.includes("metric")) return <NavChartIcon />;
  if (key.includes("bucket")) return <NavBucketIcon />;
  if (key.includes("browser")) return <NavFolderIcon />;
  if (key.includes("user")) return <NavUserIcon />;
  if (key.includes("group")) return <NavGroupIcon />;
  if (key.includes("role")) return <NavShieldIcon />;
  if (key.includes("polic")) return <NavDocumentIcon />;
  if (key.includes("setting")) return <NavCogIcon />;
  if (key.includes("topic") || key.includes("event")) return <NavBellIcon />;
  if (key.includes("billing")) return <NavWalletIcon />;
  if (key.includes("manage")) return <NavToolsIcon />;
  if (key.includes("account")) return <NavStackIcon />;
  return <NavDotIcon />;
}

function NavHomeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 9.5 10 4l7 5.5V17H3V9.5Z" />
    </svg>
  );
}

function NavChartIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 16V9m6 7V4m6 12v-6" />
    </svg>
  );
}

function NavBucketIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 6h12l-1 9H5L4 6Zm2-2h8" />
    </svg>
  );
}

function NavFolderIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M2.5 6.5h5l1.5 1.8H17v7.2H2.5V6.5Z" />
    </svg>
  );
}

function NavUserIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <circle cx="10" cy="6.5" r="2.6" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4.5 15.5c1.4-2 3-3 5.5-3s4.1 1 5.5 3" />
    </svg>
  );
}

function NavGroupIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <circle cx="7" cy="7.2" r="2.2" strokeWidth={1.6} />
      <circle cx="13.1" cy="8.1" r="1.8" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3.8 15.2c.9-1.6 2-2.4 3.8-2.4 1.7 0 2.8.8 3.7 2.4m1.3-2.2c1.3.1 2.2.8 3 2" />
    </svg>
  );
}

function NavShieldIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10 3.5 15.5 5.8v4.8c0 2.8-1.8 4.8-5.5 6.2-3.7-1.4-5.5-3.4-5.5-6.2V5.8L10 3.5Z" />
    </svg>
  );
}

function NavDocumentIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 3.5h6l3 3V16.5H6V3.5Zm6 0v3h3" />
    </svg>
  );
}

function NavCogIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeWidth={1.7} d="M4 5.5h12" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M4 10h12" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M4 14.5h12" />
      <circle cx="7.2" cy="5.5" r="1.5" strokeWidth={1.7} />
      <circle cx="12.4" cy="10" r="1.5" strokeWidth={1.7} />
      <circle cx="9.5" cy="14.5" r="1.5" strokeWidth={1.7} />
    </svg>
  );
}

function NavBellIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10 4.2a3.2 3.2 0 0 0-3.2 3.2v2.2c0 .9-.3 1.7-1 2.3l-.8.7h10l-.8-.7c-.7-.6-1-1.4-1-2.3V7.4A3.2 3.2 0 0 0 10 4.2Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8.6 14.5a1.5 1.5 0 0 0 2.8 0" />
    </svg>
  );
}

function NavWalletIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.5 6.5h13v8h-13v-8Zm9.2 3.8h2.8M3.5 6.5l1.8-2h9.2l2 2" />
    </svg>
  );
}

function NavToolsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 5.5 8.5 9 6.8 10.7 3.3 7.2 5 5.5Zm6.8-1.8 3 3-6.1 6.1a2.2 2.2 0 1 1-3.1-3.1l6.2-6.2Z" />
    </svg>
  );
}

function NavStackIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 6.2 10 3l7 3.2L10 9.5 3 6.2Zm0 4.3L10 14l7-3.5M3 14.2 10 17l7-2.8" />
    </svg>
  );
}

function NavDotIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <circle cx="10" cy="10" r="2.2" />
    </svg>
  );
}
