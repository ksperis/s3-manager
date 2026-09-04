/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import UiButton from "../../components/ui/UiButton";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";
import { cx, uiMenuClass, uiMenuItemClass } from "../../components/ui/styles";
import DetailsDrawerShell from "./DetailsDrawerShell";

type ObjectDetailsDrawerAction = {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "danger";
  onSelect: () => void;
};

type ObjectDetailsDrawerProps = {
  activeTab?: string;
  children: ReactNode;
  copyPathLabel: string;
  moreLabel: string;
  name: string;
  notice?: ReactNode;
  onClose: () => void;
  onCopyPath: () => void;
  onTabChange?: (tabId: string) => void;
  path: string;
  primaryAction?: {
    label: string;
    loading?: boolean;
    disabled?: boolean;
    onSelect: () => void;
  };
  secondaryActions?: readonly ObjectDetailsDrawerAction[];
  tabs?: readonly { id: string; label: string }[];
  tabsAriaLabel?: string;
};

export default function ObjectDetailsDrawer({
  activeTab,
  children,
  copyPathLabel,
  moreLabel,
  name,
  notice,
  onClose,
  onCopyPath,
  onTabChange,
  path,
  primaryAction,
  secondaryActions = [],
  tabs = [],
  tabsAriaLabel,
}: ObjectDetailsDrawerProps) {
  const moreButtonAnchorRef = useRef<HTMLSpanElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  useDismissibleLayer({
    open: moreMenuOpen,
    insideRefs: [moreButtonAnchorRef, moreMenuRef],
    onDismiss: () => setMoreMenuOpen(false),
    dismissOnEscape: false,
  });

  useEffect(() => {
    setMoreMenuOpen(false);
  }, [name, path]);

  useEffect(() => {
    if (secondaryActions.length === 0) setMoreMenuOpen(false);
  }, [secondaryActions.length]);

  return (
    <DetailsDrawerShell
      title={name}
      subtitle={
        <div className="flex min-w-0 items-center gap-2 ui-caption text-[var(--ui-text-muted)]">
          <span className="min-w-0 flex-1 truncate" title={path}>
            {path}
          </span>
          <button
            type="button"
            className="shrink-0 font-semibold text-primary hover:underline"
            onClick={onCopyPath}
          >
            {copyPathLabel}
          </button>
        </div>
      }
      actions={
        primaryAction || secondaryActions.length > 0 ? (
          <>
            {primaryAction ? (
              <UiButton
                size="sm"
                variant="primary"
                loading={primaryAction.loading}
                disabled={primaryAction.disabled}
                onClick={primaryAction.onSelect}
              >
                {primaryAction.label}
              </UiButton>
            ) : null}
            {secondaryActions.length > 0 ? (
              <span ref={moreButtonAnchorRef} className="shrink-0">
                <button
                  type="button"
                  className="h-8 rounded-md border border-[color:var(--ui-border)] px-3 py-1.5 text-xs font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-hover)]"
                  aria-haspopup="menu"
                  aria-expanded={moreMenuOpen}
                  onClick={() => setMoreMenuOpen((current) => !current)}
                >
                  {moreLabel}
                </button>
                <AnchoredPortalMenu
                  open={moreMenuOpen}
                  anchorRef={moreButtonAnchorRef}
                  placement="bottom-end"
                  offset={6}
                  minWidth={176}
                  className={cx(uiMenuClass, "p-1.5")}
                >
                  <div ref={moreMenuRef} role="menu" aria-label={moreLabel}>
                    {secondaryActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        role="menuitem"
                        className={cx(
                          uiMenuItemClass,
                          "block w-full",
                          action.tone === "danger"
                            ? "text-rose-600 dark:text-rose-300"
                            : undefined,
                        )}
                        disabled={action.disabled}
                        title={action.title}
                        onClick={() => {
                          setMoreMenuOpen(false);
                          action.onSelect();
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </AnchoredPortalMenu>
              </span>
            ) : null}
          </>
        ) : undefined
      }
      activeTab={activeTab}
      tabs={tabs}
      tabsAriaLabel={tabsAriaLabel}
      notice={notice}
      onClose={onClose}
      onEscape={() => {
        if (moreMenuOpen) {
          setMoreMenuOpen(false);
          return;
        }
        onClose();
      }}
      onTabChange={onTabChange}
    >
      {children}
    </DetailsDrawerShell>
  );
}
