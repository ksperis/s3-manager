import type { BrowserItem } from "./browserTypes";

export function isBrowserInteractiveTarget(
  target: EventTarget | null,
): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.closest("button, a, input, textarea, select, label"),
  );
}

export function resolveBrowserItemOpenLabel(item: BrowserItem): string {
  if (item.isDeleted) return `Open versions for ${item.name}`;
  return item.type === "folder"
    ? `Open folder ${item.name}`
    : `Open file ${item.name}`;
}
