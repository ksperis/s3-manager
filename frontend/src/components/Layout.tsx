/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import Header from "./Header";
import Sidebar, { SidebarLink, SidebarSection } from "./Sidebar";
import Topbar from "./Topbar";

type LayoutProps = {
  navLinks?: SidebarLink[];
  navSections?: SidebarSection[];
  headerTitle: string;
  headerSubtitle?: string;
  headerContext?: string;
  sidebarTitle?: string;
  headerInlineAction?: ReactNode;
  topbarContent?: ReactNode;
  projectName?: string;
  hideHeader?: boolean;
  topbarAction?: ReactNode;
  sidebarAction?: ReactNode;
  hideSidebar?: boolean;
};

function getUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { email?: string | null };
    return parsed.email ?? null;
  } catch {
    return null;
  }
}

export default function Layout({
  navLinks = [],
  navSections,
  headerTitle,
  headerSubtitle,
  headerContext,
  sidebarTitle,
  headerInlineAction,
  topbarContent,
  projectName,
  hideHeader = false,
  topbarAction,
  sidebarAction,
  hideSidebar = false,
}: LayoutProps) {
  const userEmail = getUserEmail();
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
  };
  const heroInlineAction = topbarContent ? undefined : headerInlineAction;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <Topbar
        projectName={projectName}
        section={headerTitle}
        inlineContent={topbarContent ?? headerInlineAction}
        userEmail={userEmail}
        onLogout={logout}
        contextAction={topbarAction}
      />
      <div className="flex pt-14">
        {!hideSidebar && (
          <Sidebar title={sidebarTitle} sections={navSections} links={navLinks} headerAction={sidebarAction} />
        )}
        <main className="flex-1 overflow-y-auto bg-surface px-3 pb-8 pt-3 sm:px-6 dark:bg-slate-950">
          {!hideHeader && (
            <Header
              title={headerTitle}
              subtitle={headerSubtitle}
              context={headerContext}
              inlineAction={heroInlineAction}
            />
          )}
          <div className="space-y-4">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
