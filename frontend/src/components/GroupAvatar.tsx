/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { UiGroupAvatarDescriptor, UiGroupAvatarIcon } from "../api/groups";
import { fetchAuthenticatedAvatarImage } from "../api/avatarImages";
import { cx } from "./ui/styles";
import { useAuthenticatedAvatarUrl } from "./useAuthenticatedAvatarUrl";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const sizeClasses: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[9px]",
  sm: "h-7 w-7 text-[10px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-12 w-12 text-sm",
  xl: "h-20 w-20 text-xl",
};

const iconPaths: Record<UiGroupAvatarIcon, string> = {
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  building: "M3 21h18 M6 21V5l6-3 6 3v16 M9 9h.01 M9 13h.01 M9 17h.01 M15 9h.01 M15 13h.01 M15 17h.01",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10 M9 12l2 2 4-4",
  briefcase: "M9 6V4h6v2 M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2 M2 12h20 M10 12v2h4v-2",
  academic: "M2 10l10-6 10 6-10 6L2 10 M6 12v5c3 3 9 3 12 0v-5 M22 10v6",
};

function fallbackInitials(name: string): string {
  const parts = name.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || "GR").toUpperCase();
}

export default function GroupAvatar({
  avatar,
  name,
  size = "md",
  className,
  title,
  decorative = false,
}: {
  avatar?: UiGroupAvatarDescriptor | null;
  name: string;
  size?: AvatarSize;
  className?: string;
  title?: string;
  decorative?: boolean;
}) {
  const sourceUrl = avatar?.url?.trim() || null;
  const authenticated = avatar?.source === "uploaded" && Boolean(sourceUrl?.startsWith("/"));
  const { loadedUrl, imageFailed, setImageFailed } = useAuthenticatedAvatarUrl(
    sourceUrl,
    fetchAuthenticatedAvatarImage,
    authenticated,
  );
  const showImage = Boolean(loadedUrl && !imageFailed && avatar?.source === "uploaded");
  const icon = avatar?.source === "preset" && avatar.icon ? avatar.icon : null;
  const label = title || name;

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      title={decorative ? undefined : label}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-[var(--ui-surface)] bg-indigo-100 font-bold uppercase text-indigo-700 shadow-sm dark:bg-indigo-900/60 dark:text-indigo-100",
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
      ) : icon ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[62%] w-[62%] fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={iconPaths[icon]} />
        </svg>
      ) : (
        <span aria-hidden="true">{avatar?.initials || fallbackInitials(name)}</span>
      )}
    </span>
  );
}
