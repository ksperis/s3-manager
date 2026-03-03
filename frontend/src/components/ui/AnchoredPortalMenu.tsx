/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { CSSProperties, ReactNode, RefObject, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AnchoredMenuPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

type UseAnchoredMenuPositionParams = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLElement | null>;
  placement?: AnchoredMenuPlacement;
  offset?: number;
  minWidth?: number | "anchor";
};

type AnchoredPortalMenuProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: AnchoredMenuPlacement;
  offset?: number;
  minWidth?: number | "anchor";
  className?: string;
  children: ReactNode;
};

const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveX(rect: DOMRect, width: number, placement: AnchoredMenuPlacement): number {
  if (placement.endsWith("end")) {
    return rect.right - width;
  }
  return rect.left;
}

function resolveY(
  rect: DOMRect,
  height: number,
  viewportHeight: number,
  placement: AnchoredMenuPlacement,
  offset: number
): number {
  const preferTop = placement.startsWith("top");
  const below = rect.bottom + offset;
  const above = rect.top - height - offset;
  const canFitBelow = below + height <= viewportHeight - VIEWPORT_MARGIN;
  const canFitAbove = above >= VIEWPORT_MARGIN;

  if (preferTop) {
    if (canFitAbove) return above;
    if (canFitBelow) return below;
    return clamp(above, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN));
  }
  if (canFitBelow) return below;
  if (canFitAbove) return above;
  return clamp(below, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN));
}

export function useAnchoredMenuPosition({
  open,
  anchorRef,
  menuRef,
  placement = "bottom-start",
  offset = 8,
  minWidth = "anchor",
}: UseAnchoredMenuPositionParams): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    top: -9999,
    left: -9999,
    minWidth: 0,
    zIndex: 70,
  });

  useLayoutEffect(() => {
    if (!open) return;
    let rafId = 0;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;

      const anchorRect = anchor.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxWidth = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
      const targetMinWidth =
        minWidth === "anchor" ? anchorRect.width : Math.max(0, Math.min(minWidth, maxWidth));
      const menuWidth = Math.min(Math.max(menuRect.width, targetMinWidth), maxWidth);
      const x = clamp(
        resolveX(anchorRect, menuWidth, placement),
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, viewportWidth - menuWidth - VIEWPORT_MARGIN)
      );
      const y = resolveY(anchorRect, menuRect.height, viewportHeight, placement, offset);

      setStyle({
        position: "fixed",
        top: Math.round(y),
        left: Math.round(x),
        minWidth: Math.round(targetMinWidth),
        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
        zIndex: 70,
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updatePosition);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("orientationchange", scheduleUpdate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("orientationchange", scheduleUpdate);
    };
  }, [anchorRef, menuRef, minWidth, offset, open, placement]);

  return style;
}

export default function AnchoredPortalMenu({
  open,
  anchorRef,
  placement = "bottom-start",
  offset = 8,
  minWidth = "anchor",
  className,
  children,
}: AnchoredPortalMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const style = useAnchoredMenuPosition({
    open,
    anchorRef,
    menuRef,
    placement,
    offset,
    minWidth,
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div ref={menuRef} style={style} className={className}>
      {children}
    </div>,
    document.body
  );
}
