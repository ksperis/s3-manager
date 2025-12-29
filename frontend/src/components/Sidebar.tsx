/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
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
  const baseLinkClasses =
    "group flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-semibold leading-4 transition-colors";
  const inactiveLinkClasses =
    "text-slate-600 hover:bg-primary-50 hover:text-primary-700 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-primary-100";
  const activeLinkClasses = "bg-primary-100/80 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100";
  const badgeClasses =
    "rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 group-hover:bg-primary-100 group-hover:text-primary-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-primary-800/50 dark:group-hover:text-primary-50";

  return (
    <aside className="hidden w-56 shrink-0 border-r border-slate-200/80 bg-white/95 px-2 pt-4 dark:border-slate-800 dark:bg-slate-900/70 md:flex md:flex-col">
      <div className="px-2 pb-4">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</div>
          {headerAction ? <div>{headerAction}</div> : null}
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-3 pb-6">
        {effectiveSections.map((section) => (
          <div key={section.label} className="space-y-1">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {section.label}
            </p>
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
          </div>
        ))}
      </nav>
    </aside>
  );
}
