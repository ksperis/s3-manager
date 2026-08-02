/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  StorageSpaceIconDescriptor,
  StorageSpaceIconPreset,
} from "../api/storageSpaceIcons";
import { fetchAuthenticatedAvatarImage } from "../api/avatarImages";
import { cx } from "./ui/styles";
import { useAuthenticatedAvatarUrl } from "./useAuthenticatedAvatarUrl";

export const storageSpaceIconPresets: StorageSpaceIconPreset[] = [
  "bucket",
  "folder",
  "archive",
  "database",
  "media",
];

const iconPaths: Record<StorageSpaceIconPreset, string> = {
  bucket: "M4 7c0-2 3.58-3.5 8-3.5S20 5 20 7v10c0 2-3.58 3.5-8 3.5S4 19 4 17V7 M4 7c0 2 3.58 3.5 8 3.5S20 9 20 7 M4 12c0 2 3.58 3.5 8 3.5s8-1.5 8-3.5",
  folder: "M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z",
  archive: "M4 7h16v13H4V7 M3 3h18v4H3V3 M9 11h6",
  database: "M4 6c0-2 3.58-3.5 8-3.5S20 4 20 6v12c0 2-3.58 3.5-8 3.5S4 20 4 18V6 M4 6c0 2 3.58 3.5 8 3.5S20 8 20 6 M4 12c0 2 3.58 3.5 8 3.5s8-1.5 8-3.5",
  media: "M4 4h16v16H4V4 M7 16l3-3 2 2 3-4 3 5 M8 9h.01",
};

const sizeClasses = {
  compact: "h-4 w-4",
  sidebar: "h-6 w-6",
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-12 w-12",
};

export default function StorageSpaceIcon({
  icon,
  name,
  size = "sm",
  className,
  decorative = false,
}: {
  icon?: StorageSpaceIconDescriptor | null;
  name: string;
  size?: keyof typeof sizeClasses;
  className?: string;
  decorative?: boolean;
}) {
  const sourceUrl = icon?.url?.trim() || null;
  const authenticated = icon?.source === "uploaded" && Boolean(sourceUrl?.startsWith("/"));
  const { loadedUrl, imageFailed, setImageFailed } = useAuthenticatedAvatarUrl(
    sourceUrl,
    fetchAuthenticatedAvatarImage,
    authenticated,
  );
  const showImage = Boolean(icon?.source === "uploaded" && loadedUrl && !imageFailed);
  const preset = icon?.source === "preset" && icon.preset ? icon.preset : "bucket";

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : `${name} icon`}
      data-storage-space-icon-source={showImage ? "uploaded" : "preset"}
      data-storage-space-icon-preset={showImage ? undefined : preset}
      className={cx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-100",
        sizeClasses[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={loadedUrl ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-[62%] w-[62%] fill-none stroke-current"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={iconPaths[preset]} />
        </svg>
      )}
    </span>
  );
}
