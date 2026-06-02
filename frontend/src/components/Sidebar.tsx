/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  CSSProperties,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { NavLink } from "react-router-dom";
import { SIDEBAR_COMPACT_WIDTH, SIDEBAR_MAX_WIDTH } from "./sidebarSizing";

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
}: SidebarProps) {
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

  const baseLinkClasses = compact
    ? "group relative flex h-9 items-center justify-center rounded-md px-2 ui-caption font-semibold leading-4 transition"
    : "group relative flex h-8 items-center justify-between gap-2 overflow-hidden rounded-md px-2.5 ui-caption font-semibold leading-4 transition";
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
      ? `relative hidden h-full shrink-0 border-r border-slate-200 bg-white/95 dark:border-slate-800 dark:bg-slate-950 md:flex md:flex-col ${
          compact ? "px-1.5" : "px-0"
        } ${resizing ? "" : "transition-[width,padding] duration-200 ease-out"}`
      : "flex h-full flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950";
  const rootClassName = className ? `${containerClasses} ${className}` : containerClasses;
  const iconClasses = compact ? "h-4 w-4" : "h-3.5 w-3.5";
  const rootStyle: CSSProperties | undefined =
    variant === "desktop" && width
      ? {
          width: `${width}px`,
        }
      : undefined;

  return (
    <aside className={rootClassName} style={rootStyle} data-sidebar-variant={variant}>
      <nav
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-3 ${compact ? "px-0" : "px-2.5"}`}
        aria-label={`${title} navigation`}
      >
        {!compact && headerAction ? <div className="pb-1">{headerAction}</div> : null}
        {effectiveSections.map((section) => {
          const collapsible = isSectionCollapsible(section);
          const isCollapsed = compact ? false : collapsedSections[section.label];
          return (
            <section
              key={section.label}
              className="space-y-1"
            >
              {compact ? (
                <div className="mx-auto my-1 h-1 w-6 rounded-full bg-slate-200 dark:bg-slate-700" />
              ) : collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleSection(section.label, collapsible)}
                  className="flex h-5 w-full items-center justify-between rounded-md px-1.5 text-[10px] font-bold uppercase text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                >
                  <span>{section.label}</span>
                  <SidebarChevronIcon className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                </button>
              ) : (
                <div className="px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                  {section.label}
                </div>
              )}
              {!isCollapsed && (
                <ul className="space-y-px">
                  {section.links.map((link) => (
                    <li key={link.to}>
                      {link.disabled ? (
                        <div
                          className={`${baseLinkClasses} ${inactiveLinkClasses} cursor-not-allowed opacity-50`}
                          aria-disabled="true"
                          aria-label={compact ? link.label : undefined}
                          title={link.disabledHint ?? DEFAULT_DISABLED_HINT}
                        >
                          <div className={`flex min-w-0 items-center ${compact ? "" : "gap-1.5"}`}>
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
                              <div className={`flex min-w-0 items-center ${compact ? "" : "gap-1.5"}`}>
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
      {footer ? <div className={`shrink-0 overflow-hidden border-t border-slate-200 dark:border-slate-800 ${compact ? "p-2" : "p-3"}`}>{footer}</div> : null}
      {variant === "desktop" && onCollapseToggle ? (
        <div className={`shrink-0 border-t border-slate-200 dark:border-slate-800 ${compact ? "p-2" : "p-3"}`}>
          <button
            type="button"
            onClick={onCollapseToggle}
            aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
            title={compact ? "Expand" : undefined}
            className={`flex h-8 w-full items-center rounded-md text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-50 ${
              compact ? "justify-center px-2" : "gap-2 px-2.5"
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

function SidebarChevronIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m7 5 6 5-6 5" />
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
