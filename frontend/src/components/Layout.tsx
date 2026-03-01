/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { logout as logoutRequest } from "../api/auth";
import Header from "./Header";
import Sidebar, { SidebarLink, SidebarSection } from "./Sidebar";
import Topbar from "./Topbar";
import type { TopbarControlDescriptor } from "./topbarControlsLayout";

type LayoutProps = {
  navLinks?: SidebarLink[];
  navSections?: SidebarSection[];
  headerTitle: string;
  headerSubtitle?: string;
  headerContext?: string;
  sidebarTitle?: string;
  headerInlineAction?: ReactNode;
  topbarContent?: ReactNode;
  topbarControls?: ReactNode;
  topbarControlDescriptors?: TopbarControlDescriptor[];
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

function buildSidebarCompactStorageKey(sidebarTitle?: string, headerTitle?: string): string {
  const source = (sidebarTitle || headerTitle || "default").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `sidebar_compact_${source}`;
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
  topbarControls,
  topbarControlDescriptors,
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
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const sidebarCompactStorageKey = buildSidebarCompactStorageKey(sidebarTitle, headerTitle);
  const [desktopSidebarCompact, setDesktopSidebarCompact] = useState(false);
  const shouldShowSidebar = !hideSidebar;
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
  const hasTopbarControls = Boolean(topbarControls) || Boolean(topbarControlDescriptors?.length);
  const heroInlineAction = topbarContent || hasTopbarControls ? undefined : headerInlineAction;
  const resolvedInlineTopbarContent = topbarContent ?? (hasTopbarControls ? undefined : headerInlineAction);
  const mainOverflowClass = disableMainScroll ? "overflow-hidden" : "overflow-y-auto";
  const mainClasses = `flex min-h-0 flex-1 flex-col ${mainOverflowClass} bg-surface px-3 pb-8 pt-3 sm:px-6 dark:bg-slate-950${
    mainClassName ? ` ${mainClassName}` : ""
  }`;
  const rootHeightClass = fullHeight ? "h-screen" : "min-h-screen";
  const drawerTopClass = hideTopbar ? "top-0" : "top-14";

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!shouldShowSidebar) {
      setMobileSidebarOpen(false);
    }
  }, [shouldShowSidebar]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!shouldShowSidebar) return;
    const raw = window.localStorage.getItem(sidebarCompactStorageKey);
    setDesktopSidebarCompact(raw === "1");
  }, [shouldShowSidebar, sidebarCompactStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(sidebarCompactStorageKey, desktopSidebarCompact ? "1" : "0");
  }, [desktopSidebarCompact, sidebarCompactStorageKey]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileSidebarOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleResize);
    };
  }, [mobileSidebarOpen]);

  return (
    <div className={`flex ${rootHeightClass} flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50`}>
      {!hideTopbar && (
        <Topbar
          projectName={projectName}
          section={headerTitle}
          inlineContent={resolvedInlineTopbarContent}
          controlsContent={topbarControls}
          controlDescriptors={topbarControlDescriptors}
          userEmail={userEmail}
          onLogout={logout}
          contextAction={topbarAction}
          showMobileMenuButton={shouldShowSidebar}
          mobileMenuOpen={mobileSidebarOpen}
          onMobileMenuToggle={() => setMobileSidebarOpen((open) => !open)}
        />
      )}
      {shouldShowSidebar && (
        <div
          className={`fixed inset-x-0 bottom-0 ${drawerTopClass} z-[44] md:hidden ${
            mobileSidebarOpen ? "pointer-events-auto" : "pointer-events-none"
          }`}
          aria-hidden={!mobileSidebarOpen}
        >
          <button
            type="button"
            tabIndex={mobileSidebarOpen ? 0 : -1}
            aria-label="Fermer la navigation mobile"
            onClick={() => setMobileSidebarOpen(false)}
            className={`absolute inset-0 bg-slate-950/45 transition-opacity duration-200 ${
              mobileSidebarOpen ? "opacity-100" : "opacity-0"
            }`}
          />
          <div id="mobile-navigation-panel" className="absolute left-0 top-0 h-full w-[18.5rem] max-w-[86vw]">
            <Sidebar
              variant="mobile"
              className={`shadow-2xl transition-transform duration-200 ${
                mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
              }`}
              title={sidebarTitle}
              sections={navSections}
              links={navLinks}
              headerAction={sidebarAction}
              onNavigate={() => setMobileSidebarOpen(false)}
            />
          </div>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 ${hideTopbar ? "pt-0" : "pt-14"}`}>
        {shouldShowSidebar && (
          <Sidebar
            title={sidebarTitle}
            sections={navSections}
            links={navLinks}
            headerAction={sidebarAction}
            compact={desktopSidebarCompact}
            onToggleCompact={() => setDesktopSidebarCompact((value) => !value)}
          />
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
