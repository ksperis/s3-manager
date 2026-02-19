/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

export type SidebarLink = {
  to: string;
  label: string;
  badge?: string;
  end?: boolean;
  disabled?: boolean;
};

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
  variant?: "desktop" | "mobile";
  className?: string;
  onNavigate?: () => void;
};

function isSectionCollapsible(section: SidebarSection) {
  return section.collapsible ?? section.label.trim().toLowerCase() === "settings";
}

export default function Sidebar({
  title = "s3-manager",
  sections,
  links = [],
  headerAction,
  variant = "desktop",
  className,
  onNavigate,
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

  const baseLinkClasses =
    "group flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 ui-caption font-semibold leading-4 transition";
  const inactiveLinkClasses =
    "text-slate-600 hover:bg-slate-100/90 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-50";
  const activeLinkClasses =
    "bg-gradient-to-r from-primary-100 to-primary-50 text-primary-900 ring-1 ring-primary-200/80 shadow-sm dark:from-primary-900/35 dark:to-primary-900/20 dark:text-primary-100 dark:ring-primary-700/50";
  const badgeClasses = "shrink-0 rounded-full px-1.5 py-0.5 ui-caption font-semibold";
  const activeBadgeClasses = "bg-primary-200/80 text-primary-900 dark:bg-primary-800/70 dark:text-primary-100";
  const inactiveBadgeClasses =
    "bg-slate-100 text-slate-600 group-hover:bg-slate-200/90 group-hover:text-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-700 dark:group-hover:text-slate-100";
  const containerClasses =
    variant === "desktop"
      ? "hidden w-64 shrink-0 border-r border-slate-200/80 bg-gradient-to-b from-white/95 via-white/90 to-slate-50/80 px-3 py-3 dark:border-slate-800 dark:from-slate-900/85 dark:via-slate-900/75 dark:to-slate-950/70 md:flex md:flex-col"
      : "flex h-full flex-col border-r border-slate-200/80 bg-gradient-to-b from-white/95 via-white/90 to-slate-50/80 px-3 py-3 dark:border-slate-800 dark:from-slate-900/85 dark:via-slate-900/75 dark:to-slate-950/70";
  const rootClassName = className ? `${containerClasses} ${className}` : containerClasses;

  return (
    <aside className={rootClassName}>
      <div className="mb-3 rounded-xl border border-slate-200/80 bg-white/80 p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
            <SidebarCompassIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate ui-caption font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              {title}
            </p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">Navigation</p>
          </div>
        </div>
        {headerAction ? <div className="mt-2">{headerAction}</div> : null}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-4 pr-1">
        {effectiveSections.map((section) => {
          const collapsible = isSectionCollapsible(section);
          const isCollapsed = collapsedSections[section.label];
          return (
            <section
              key={section.label}
              className="space-y-1 rounded-xl border border-slate-200/80 bg-white/75 p-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70"
            >
              {collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleSection(section.label, collapsible)}
                  className="flex h-8 w-full items-center justify-between rounded-lg px-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100/80 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-200"
                >
                  <span>{section.label}</span>
                  <SidebarChevronIcon className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                </button>
              ) : (
                <div className="px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {section.label}
                </div>
              )}
              {!isCollapsed && (
                <ul className="space-y-1">
                  {section.links.map((link) => (
                    <li key={link.to}>
                      {link.disabled ? (
                        <div
                          className={`${baseLinkClasses} ${inactiveLinkClasses} cursor-not-allowed opacity-50`}
                          aria-disabled="true"
                        >
                          <span className="truncate">{link.label}</span>
                          {link.badge && <span className={`${badgeClasses} ${inactiveBadgeClasses}`}>{link.badge}</span>}
                        </div>
                      ) : (
                        <NavLink
                          to={link.to}
                          end={link.end}
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            [baseLinkClasses, isActive ? activeLinkClasses : inactiveLinkClasses].join(" ")
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span className="truncate">{link.label}</span>
                              {link.badge && (
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
