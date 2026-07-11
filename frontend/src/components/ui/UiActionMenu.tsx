/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import AnchoredPortalMenu, { type AnchoredMenuPlacement } from "./AnchoredPortalMenu";
import { cx, uiMenuClass, uiMenuItemClass, uiMutedTextClass } from "./styles";

export type UiActionMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
};

export type UiActionMenuSection = {
  id: string;
  label: string;
  items: UiActionMenuItem[];
};

type UiActionMenuProps = {
  ariaLabel: string;
  trigger: ReactNode;
  triggerClassName: string;
  sections: UiActionMenuSection[];
  placement?: AnchoredMenuPlacement;
  minWidth?: number;
  menuClassName?: string;
};

const enabledMenuItemSelector = '[role="menuitem"]:not([aria-disabled="true"])';

export default function UiActionMenu({
  ariaLabel,
  trigger,
  triggerClassName,
  sections,
  placement = "bottom-end",
  minWidth = 240,
  menuClassName,
}: UiActionMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>(enabledMenuItemSelector);
    firstItem?.focus();

    const closeAndReturnFocus = () => {
      setOpen(false);
      triggerRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target || triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndReturnFocus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(enabledMenuItemSelector) ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Home") {
      items[0].focus();
      return;
    }
    if (event.key === "End") {
      items[items.length - 1].focus();
      return;
    }
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = activeIndex < 0 ? 0 : (activeIndex + delta + items.length) % items.length;
    items[nextIndex].focus();
  };

  const visibleSections = sections.filter((section) => section.items.length > 0);

  return (
    <span className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger}
      </button>
      <AnchoredPortalMenu
        open={open}
        anchorRef={triggerRef}
        placement={placement}
        offset={4}
        minWidth={minWidth}
        className={cx(uiMenuClass, "p-1.5", menuClassName)}
      >
        <div ref={menuRef} role="menu" aria-label={ariaLabel} onKeyDown={handleMenuKeyDown}>
          {visibleSections.map((section, sectionIndex) => (
            <div
              key={section.id}
              className={cx(sectionIndex > 0 && "mt-1 border-t border-[color:var(--ui-border-soft)] pt-1")}
            >
              <p
                role="presentation"
                className={cx("px-2 py-1 ui-caption font-semibold uppercase tracking-wide", uiMutedTextClass)}
              >
                {section.label}
              </p>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={cx(
                    uiMenuItemClass,
                    "flex w-full items-center px-2 py-1.5 text-left ui-caption font-semibold",
                    item.disabled && "cursor-not-allowed opacity-60",
                    item.danger && "text-rose-700 dark:text-rose-300"
                  )}
                  aria-disabled={item.disabled || undefined}
                  title={item.disabled ? item.disabledReason : undefined}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span>{item.label}</span>
                    {item.disabled && item.disabledReason ? (
                      <span className={cx("mt-0.5 font-normal leading-4", uiMutedTextClass)}>{item.disabledReason}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </AnchoredPortalMenu>
    </span>
  );
}
