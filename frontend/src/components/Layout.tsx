/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { logout as logoutRequest } from "../api/auth";
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
  hideTopbar?: boolean;
  topbarAction?: ReactNode;
  sidebarAction?: ReactNode;
  hideSidebar?: boolean;
  mainClassName?: string;
  disableMainScroll?: boolean;
  fullHeight?: boolean;
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
  hideTopbar = false,
  topbarAction,
  sidebarAction,
  hideSidebar = false,
  mainClassName,
  disableMainScroll = false,
  fullHeight = false,
}: LayoutProps) {
  const userEmail = getUserEmail();
  const logout = () => {
    void logoutRequest().catch((err) => {
      console.warn("Unable to revoke refresh session", err);
    });
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("s3SessionEndpoint");
    window.location.href = "/login";
  };
  const heroInlineAction = topbarContent ? undefined : headerInlineAction;
  const mainOverflowClass = disableMainScroll ? "overflow-hidden" : "overflow-y-auto";
  const mainClasses = `flex min-h-0 flex-1 flex-col ${mainOverflowClass} bg-surface px-3 pb-8 pt-3 sm:px-6 dark:bg-slate-950${
    mainClassName ? ` ${mainClassName}` : ""
  }`;
  const rootHeightClass = fullHeight ? "h-screen" : "min-h-screen";

  return (
    <div className={`flex ${rootHeightClass} flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50`}>
      {!hideTopbar && (
        <Topbar
          projectName={projectName}
          section={headerTitle}
          inlineContent={topbarContent ?? headerInlineAction}
          userEmail={userEmail}
          onLogout={logout}
          contextAction={topbarAction}
        />
      )}
      <div className={`flex min-h-0 flex-1 ${hideTopbar ? "pt-0" : "pt-14"}`}>
        {!hideSidebar && (
          <Sidebar title={sidebarTitle} sections={navSections} links={navLinks} headerAction={sidebarAction} />
        )}
        <main className={mainClasses}>
          {!hideHeader && (
            <Header
              title={headerTitle}
              subtitle={headerSubtitle}
              context={headerContext}
              inlineAction={heroInlineAction}
            />
          )}
          <div className="flex min-h-0 flex-1 flex-col space-y-4">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
