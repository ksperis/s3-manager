/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { logout as logoutRequest } from "../api/auth";
import Header from "./Header";
import Sidebar, { SidebarLink, SidebarSection } from "./Sidebar";
import { useWorkspaceSwitcherModel } from "./EnvironmentSwitcher";
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
  sidebarContent?: ReactNode;
  sidebarContentLabel?: string;
  sidebarFooter?: ReactNode;
  sidebarWidthPx?: number;
  allowSidebarCollapse?: boolean;
  hideSidebar?: boolean;
  mainClassName?: string;
  disableMainScroll?: boolean;
  fullHeight?: boolean;
  children?: ReactNode;
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
  topbarControls,
  topbarControlDescriptors,
  projectName,
  hideHeader = false,
  hideTopbar = false,
  topbarAction,
  sidebarAction,
  sidebarContent,
  sidebarContentLabel,
  sidebarFooter,
  sidebarWidthPx,
  allowSidebarCollapse = true,
  hideSidebar = false,
  mainClassName,
  disableMainScroll = false,
  fullHeight = false,
  children,
}: LayoutProps) {
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCompact, setDesktopSidebarCompact] = useState(false);
  const shouldShowSidebar = !hideSidebar;
  const userEmail = getUserEmail();
  const workspaceSwitcher = useWorkspaceSwitcherModel();
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
  const mainClasses = `shell-page flex min-h-0 min-w-0 flex-1 flex-col ${mainOverflowClass} px-4 pb-8 pt-4 sm:px-8${
    mainClassName ? ` ${mainClassName}` : ""
  }`;
  const rootHeightClass = fullHeight ? "h-[100dvh]" : "h-screen";
  const drawerTopClass = hideTopbar ? "top-0" : "top-14";
  const hasSidebarNavigation = Boolean(navSections?.length) || navLinks.length > 0;
  const shouldShowMobileSidebar = shouldShowSidebar && (!sidebarContent || hasSidebarNavigation);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!shouldShowSidebar) {
      setMobileSidebarOpen(false);
    }
  }, [shouldShowSidebar]);

  useEffect(() => {
    if (!allowSidebarCollapse) {
      setDesktopSidebarCompact(false);
    }
  }, [allowSidebarCollapse]);

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

  const handleDesktopSidebarCollapseToggle = () => {
    setDesktopSidebarCompact((current) => !current);
  };

  return (
    <div className={`shell-page flex ${rootHeightClass} overflow-hidden`}>
      {shouldShowSidebar && (
        <Sidebar
          title={sidebarTitle}
          sections={navSections}
          links={navLinks}
          headerAction={sidebarAction}
          content={sidebarContent}
          contentLabel={sidebarContentLabel}
          footer={sidebarFooter}
          compact={desktopSidebarCompact}
          onCollapseToggle={allowSidebarCollapse ? handleDesktopSidebarCollapseToggle : undefined}
          widthPx={sidebarWidthPx}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
            showMobileMenuButton={shouldShowMobileSidebar}
            mobileMenuOpen={mobileSidebarOpen}
            onMobileMenuToggle={() => setMobileSidebarOpen((open) => !open)}
            showWorkspaceSwitcher
            workspaceSwitcher={workspaceSwitcher}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {shouldShowMobileSidebar && (
            <div
              className={`fixed inset-x-0 bottom-0 ${drawerTopClass} z-[44] md:hidden ${
                mobileSidebarOpen ? "pointer-events-auto" : "pointer-events-none"
              }`}
              aria-hidden={!mobileSidebarOpen}
            >
              <button
                type="button"
                tabIndex={mobileSidebarOpen ? 0 : -1}
                aria-label="Close mobile navigation"
                onClick={() => setMobileSidebarOpen(false)}
                className={`absolute inset-0 bg-slate-950/45 transition-opacity duration-200 ${
                  mobileSidebarOpen ? "opacity-100" : "opacity-0"
                }`}
              />
              <div id="mobile-navigation-panel" className="absolute left-0 top-0 h-full w-[16rem] max-w-[86vw]">
                <Sidebar
                  variant="mobile"
                  className={`shadow-[var(--shell-menu-shadow)] transition-transform duration-200 ${
                    mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
                  }`}
                  title={sidebarTitle}
                  sections={navSections}
                  links={navLinks}
                  headerAction={sidebarAction}
                  footer={sidebarFooter}
                  onNavigate={() => setMobileSidebarOpen(false)}
                />
              </div>
            </div>
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
            <div className="flex min-h-0 min-w-0 flex-1 flex-col space-y-4">
              {children ?? <Outlet />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
