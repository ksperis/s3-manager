import type { BrowserItem } from "./browserTypes";

export function resolveBrowserItemOpenLabel(item: BrowserItem): string {
  if (item.isDeleted) return `Open versions for ${item.name}`;
  return item.type === "folder"
    ? `Open folder ${item.name}`
    : `Open file ${item.name}`;
}
