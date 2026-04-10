/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { logout as logoutRequest } from "../api/auth";
import Header from "./Header";
import Sidebar, { SidebarLink, SidebarSection } from "./Sidebar";
import {
  DESKTOP_SIDEBAR_SESSION_STORAGE_KEY,
  SIDEBAR_COMPACT_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_RESIZE_KEYBOARD_STEP,
  isSidebarCompact,
  normalizeSidebarWidth,
  stepSidebarWidth,
} from "./sidebarSizing";
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
  const [desktopSidebarWidth, setDesktopSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
    const raw = window.sessionStorage.getItem(DESKTOP_SIDEBAR_SESSION_STORAGE_KEY);
    return raw ? normalizeSidebarWidth(Number(raw)) : SIDEBAR_DEFAULT_WIDTH;
  });
  const [desktopSidebarDragging, setDesktopSidebarDragging] = useState(false);
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const shouldShowSidebar = !hideSidebar;
  const desktopSidebarCompact = isSidebarCompact(desktopSidebarWidth);
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
  const rootHeightClass = fullHeight ? "h-[100dvh]" : "h-screen";
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
    window.sessionStorage.setItem(DESKTOP_SIDEBAR_SESSION_STORAGE_KEY, String(desktopSidebarWidth));
  }, [desktopSidebarWidth]);

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

  useEffect(() => {
    if (!desktopSidebarDragging) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState) return;
      const nextWidth = resizeState.startWidth + (event.clientX - resizeState.startX);
      setDesktopSidebarWidth(normalizeSidebarWidth(nextWidth));
    };

    const stopDragging = () => {
      sidebarResizeStateRef.current = null;
      setDesktopSidebarDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [desktopSidebarDragging]);

  const handleDesktopSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth: desktopSidebarWidth,
    };
    setDesktopSidebarDragging(true);
  };

  const handleDesktopSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        setDesktopSidebarWidth((current) => stepSidebarWidth(current, -SIDEBAR_RESIZE_KEYBOARD_STEP));
        break;
      case "ArrowRight":
        event.preventDefault();
        setDesktopSidebarWidth((current) => stepSidebarWidth(current, SIDEBAR_RESIZE_KEYBOARD_STEP));
        break;
      case "Home":
        event.preventDefault();
        setDesktopSidebarWidth(SIDEBAR_COMPACT_WIDTH);
        break;
      case "End":
        event.preventDefault();
        setDesktopSidebarWidth(SIDEBAR_MAX_WIDTH);
        break;
      default:
        break;
    }
  };

  return (
    <div className={`flex ${rootHeightClass} flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50`}>
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
            aria-label="Close mobile navigation"
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
      <div className={`flex min-h-0 flex-1 overflow-hidden ${hideTopbar ? "pt-0" : "pt-14"}`}>
        {shouldShowSidebar && (
          <Sidebar
            title={sidebarTitle}
            sections={navSections}
            links={navLinks}
            headerAction={sidebarAction}
            width={desktopSidebarWidth}
            compact={desktopSidebarCompact}
            resizing={desktopSidebarDragging}
            onResizeStart={handleDesktopSidebarResizeStart}
            onResizeKeyDown={handleDesktopSidebarResizeKeyDown}
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
