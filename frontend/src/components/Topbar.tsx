/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import EnvironmentSwitcher from "./EnvironmentSwitcher";
import ThemeToggle from "./ThemeToggle";

type TopbarProps = {
  projectName?: string;
  section?: string;
  inlineContent?: ReactNode;
  userEmail?: string | null;
  onLogout?: () => void;
  contextAction?: ReactNode;
};

export default function Topbar({
  projectName,
  section,
  inlineContent,
  userEmail,
  onLogout,
  contextAction,
}: TopbarProps) {
  return (
    <div className="fixed inset-x-0 top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur supports-[backdrop-filter]:backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 sm:px-6">
        <div className="flex items-center">
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">{projectName ?? "S3 Manager"}</div>
            {section && <div className="text-[11px] text-slate-500 dark:text-slate-400">{section}</div>}
          </div>
        </div>

        {inlineContent && <div className="flex flex-1 items-center justify-start">{inlineContent}</div>}
        {contextAction && (
          <div className="hidden sm:flex">
            {contextAction}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <EnvironmentSwitcher />
          <ThemeToggle />
          <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-primary/60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <span className="hidden md:inline">
              {userEmail ?? "Session"}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-primary-700 transition hover:bg-primary-50 hover:text-primary-800 dark:text-primary-200 dark:hover:bg-primary-900/40"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
