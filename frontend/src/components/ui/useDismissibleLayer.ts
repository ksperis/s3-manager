/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, type RefObject } from "react";

type DismissibleLayerReason = "escape" | "outside";

type UseDismissibleLayerOptions = {
  open: boolean;
  insideRefs: readonly RefObject<Element | null>[];
  onDismiss: (reason: DismissibleLayerReason) => void;
  preventEscapeDefault?: boolean;
};

export function useDismissibleLayer({
  open,
  insideRefs,
  onDismiss,
  preventEscapeDefault = false,
}: UseDismissibleLayerOptions) {
  const insideRefsRef = useRef(insideRefs);
  const onDismissRef = useRef(onDismiss);
  insideRefsRef.current = insideRefs;
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (insideRefsRef.current.some((ref) => ref.current?.contains(target))) {
        return;
      }
      onDismissRef.current("outside");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (preventEscapeDefault) event.preventDefault();
      onDismissRef.current("escape");
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, preventEscapeDefault]);
}
