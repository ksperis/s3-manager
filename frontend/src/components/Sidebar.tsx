/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useState } from "react";
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
};

export default function Sidebar({ title = "s3-manager", sections, links = [], headerAction }: SidebarProps) {
  const effectiveSections: SidebarSection[] =
    sections && sections.length > 0 ? sections : [{ label: "Navigation", links }];
  const isSectionCollapsible = (section: SidebarSection) =>
    section.collapsible ?? section.label.trim().toLowerCase() === "settings";
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    effectiveSections.forEach((section) => {
      initial[section.label] = isSectionCollapsible(section) ? section.collapsed ?? false : false;
    });
    return initial;
  });

  const toggleSection = (label: string, collapsible: boolean) => {
    if (!collapsible) return;
    setCollapsedSections((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  };
  const baseLinkClasses =
    "group flex items-center justify-between rounded-md px-2.5 py-1.5 ui-caption font-semibold leading-4 transition-colors";
  const inactiveLinkClasses =
    "text-slate-600 hover:bg-primary-50 hover:text-primary-700 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-primary-100";
  const activeLinkClasses = "bg-primary-100/80 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100";
  const badgeClasses =
    "rounded-full bg-slate-100 px-1.5 py-0.5 ui-caption font-semibold text-slate-600 group-hover:bg-primary-100 group-hover:text-primary-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-primary-800/50 dark:group-hover:text-primary-50";

  return (
    <aside className="hidden w-56 shrink-0 border-r border-slate-200/80 bg-white/95 px-2 pt-4 dark:border-slate-800 dark:bg-slate-900/70 md:flex md:flex-col">
      <div className="px-2 pb-4">
        <div className="flex flex-col gap-2">
          <div className="ui-badge font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</div>
          {headerAction ? <div>{headerAction}</div> : null}
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-3 pb-6">
        {effectiveSections.map((section) => {
          const collapsible = isSectionCollapsible(section);
          const isCollapsed = collapsedSections[section.label];
          return (
            <div key={section.label} className="space-y-1">
              {collapsible ? (
                <button
                  onClick={() => toggleSection(section.label, collapsible)}
                  className="flex w-full items-center justify-between px-2 ui-badge font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <span>{section.label}</span>
                  <span className={`transition-transform ${isCollapsed ? "rotate-0" : "rotate-90"}`}>
                    ▶
                  </span>
                </button>
              ) : (
                <div className="px-2 ui-badge font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {section.label}
                </div>
              )}
              {!isCollapsed && (
                <ul className="space-y-1 border-l border-slate-200/80 pl-2 dark:border-slate-800">
                  {section.links.map((link) => (
                    <li key={link.to}>
                      {link.disabled ? (
                        <div
                          className={`${baseLinkClasses} ${inactiveLinkClasses} cursor-not-allowed opacity-50`}
                          aria-disabled="true"
                        >
                          <span>{link.label}</span>
                          {link.badge && <span className={badgeClasses}>{link.badge}</span>}
                        </div>
                      ) : (
                        <NavLink
                          to={link.to}
                          end={link.end}
                          className={({ isActive }) =>
                            [
                              baseLinkClasses,
                              isActive ? activeLinkClasses : inactiveLinkClasses,
                            ].join(" ")
                          }
                        >
                          <span>{link.label}</span>
                          {link.badge && <span className={badgeClasses}>{link.badge}</span>}
                        </NavLink>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
