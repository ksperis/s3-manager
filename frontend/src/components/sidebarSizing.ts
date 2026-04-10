export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_COLLAPSE_THRESHOLD = 192;
export const SIDEBAR_COMPACT_WIDTH = 88;
export const SIDEBAR_MAX_WIDTH = 384;
export const SIDEBAR_RESIZE_KEYBOARD_STEP = 16;
export const DESKTOP_SIDEBAR_SESSION_STORAGE_KEY = "app_shell_desktop_sidebar_width";

export function clampSidebarExpandedWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_COLLAPSE_THRESHOLD, width));
}

export function normalizeSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  if (width < SIDEBAR_COLLAPSE_THRESHOLD) return SIDEBAR_COMPACT_WIDTH;
  return clampSidebarExpandedWidth(width);
}

export function isSidebarCompact(width: number) {
  return width < SIDEBAR_COLLAPSE_THRESHOLD;
}

export function stepSidebarWidth(width: number, delta: number) {
  if (delta === 0) return normalizeSidebarWidth(width);
  if (width < SIDEBAR_COLLAPSE_THRESHOLD) {
    return delta > 0 ? SIDEBAR_COLLAPSE_THRESHOLD : SIDEBAR_COMPACT_WIDTH;
  }
  return normalizeSidebarWidth(width + delta);
}
