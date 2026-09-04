/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

import UiButton from "../../components/ui/UiButton";
import { getFocusableElements, trapFocusWithin } from "../../components/ui/focusTrap";
import { cx, uiDividerClass, uiTitleTextClass } from "../../components/ui/styles";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { XIcon } from "../browser/browserIcons";

const DETAILS_DRAWER_MODAL_MEDIA_QUERY = "(max-width: 1023px)";

type DetailsDrawerTab = {
  id: string;
  label: string;
};

type DetailsDrawerShellProps = {
  activeTab?: string;
  actions?: ReactNode;
  children: ReactNode;
  notice?: ReactNode;
  onClose: () => void;
  onEscape?: () => void;
  onTabChange?: (tabId: string) => void;
  subtitle?: ReactNode;
  tabs?: readonly DetailsDrawerTab[];
  tabsAriaLabel?: string;
  title: string;
};

function tabId(prefix: string, id: string) {
  return `${prefix}-tab-${id}`;
}

function panelId(prefix: string, id: string) {
  return `${prefix}-panel-${id}`;
}

export default function DetailsDrawerShell({
  activeTab,
  actions,
  children,
  notice,
  onClose,
  onEscape,
  onTabChange,
  subtitle,
  tabs = [],
  tabsAriaLabel = "Details views",
  title,
}: DetailsDrawerShellProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const idPrefix = useId();
  const modal = useMediaQuery(DETAILS_DRAWER_MODAL_MEDIA_QUERY);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        (onEscape ?? onClose)();
        return;
      }
      if (modal) trapFocusWithin(drawer, event);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modal, onClose, onEscape]);

  useEffect(() => {
    if (!modal) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = getFocusableElements(drawer);
    (focusable[0] ?? drawer).focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modal]);

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentId: string,
  ) => {
    if (!onTabChange || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    const currentIndex = tabs.findIndex((tab) => tab.id === currentId);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    event.preventDefault();
    onTabChange(tabs[nextIndex].id);
    Array.from(
      drawerRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    )
      .find((tab) => tab.dataset.detailsDrawerTab === tabs[nextIndex].id)
      ?.focus();
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[46] lg:left-auto lg:top-14">
      <section
        ref={drawerRef}
        role={modal ? "dialog" : "complementary"}
        aria-modal={modal ? true : undefined}
        aria-labelledby={`${idPrefix}-title`}
        tabIndex={-1}
        className="pointer-events-auto absolute inset-y-0 right-0 flex w-full min-w-0 flex-col overflow-hidden border-l border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--shell-menu-shadow)] lg:w-[min(48rem,calc(100vw-20rem))]"
      >
        <header className={cx("shrink-0 border-b px-4 py-3", uiDividerClass)}>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id={`${idPrefix}-title`}
                className={cx("truncate ui-subtitle", uiTitleTextClass)}
                title={title}
              >
                {title}
              </h2>
              {subtitle ? <div className="mt-1 min-w-0">{subtitle}</div> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {actions}
              <UiButton
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close details"
                title="Close details"
              >
                <XIcon className="h-4 w-4" />
              </UiButton>
            </div>
          </div>
          {tabs.length > 0 && activeTab && onTabChange ? (
            <div
              role="tablist"
              aria-label={tabsAriaLabel}
              className="mt-3 flex min-w-0 flex-wrap gap-1 border-t border-[color:var(--ui-border-soft)] pt-3"
            >
              {tabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    id={tabId(idPrefix, tab.id)}
                    data-details-drawer-tab={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={panelId(idPrefix, tab.id)}
                    tabIndex={active ? 0 : -1}
                    onClick={() => onTabChange(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                    className={cx(
                      "rounded-md px-2.5 py-1.5 ui-caption font-semibold transition",
                      active
                        ? "bg-[var(--ui-selected-bg)] text-primary dark:text-[var(--ui-text)]"
                        : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {notice ? <div className="mt-3">{notice}</div> : null}
        </header>
        <div
          id={activeTab ? panelId(idPrefix, activeTab) : undefined}
          role={activeTab ? "tabpanel" : undefined}
          aria-labelledby={activeTab ? tabId(idPrefix, activeTab) : undefined}
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
        >
          {children}
        </div>
      </section>
    </div>
  );
}
