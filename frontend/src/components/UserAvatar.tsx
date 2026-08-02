/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import type { UserAvatarDescriptor } from "../api/users";
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

function fallbackInitials(name?: string | null, email?: string | null): string {
  const label = (name ?? "").trim();
  const parts = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const localPart = (email ?? "U").split("@", 1)[0];
  return localPart.slice(0, 2).toUpperCase() || "U";
}

type UserAvatarProps = {
  avatar?: UserAvatarDescriptor | null;
  name?: string | null;
  email?: string | null;
  size?: AvatarSize;
  className?: string;
  title?: string;
  decorative?: boolean;
};

export default function UserAvatar({
  avatar,
  name,
  email,
  size = "md",
  className,
  title,
  decorative = false,
}: UserAvatarProps) {
  const label = (title || name || email || "User").trim();
  const initials = avatar?.initials || fallbackInitials(name, email);
  const sourceUrl = avatar?.url?.trim() || null;
  const authenticated = avatar?.source === "uploaded" && Boolean(sourceUrl?.startsWith("/"));
  const { loadedUrl, imageFailed, setImageFailed } = useAuthenticatedAvatarUrl(
    sourceUrl,
    fetchAuthenticatedAvatarImage,
    authenticated,
  );

  const showImage = Boolean(loadedUrl && !imageFailed && avatar?.source !== "initials");
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      title={decorative ? undefined : label}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--ui-surface)] bg-primary-100 font-bold uppercase text-primary-700 shadow-sm dark:bg-primary-900/60 dark:text-primary-100",
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
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}

type UserAvatarStackPerson = {
  user_id: number;
  email: string;
  display_name?: string | null;
  avatar?: UserAvatarDescriptor | null;
};

export function UserAvatarStack({
  people,
  totalCount,
  maxVisible = 5,
  size = "sm",
  className,
}: {
  people: UserAvatarStackPerson[];
  totalCount?: number;
  maxVisible?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const visiblePeople = people.slice(0, maxVisible);
  const count = Math.max(totalCount ?? people.length, people.length);
  const remaining = Math.max(0, count - visiblePeople.length);
  const accessibleLabel = useMemo(
    () =>
      visiblePeople.length > 0
        ? visiblePeople.map((person) => person.display_name || person.email).join(", ")
        : "No collaborators",
    [visiblePeople],
  );

  return (
    <span className={cx("inline-flex items-center -space-x-2", className)} aria-label={accessibleLabel}>
      {visiblePeople.map((person) => (
        <UserAvatar
          key={person.user_id}
          avatar={person.avatar}
          name={person.display_name || person.email}
          email={person.email}
          size={size}
          className="transition-transform hover:z-20 hover:-translate-y-0.5 focus-within:z-20"
        />
      ))}
      {remaining > 0 ? (
        <span
          title={`${remaining} more collaborator${remaining === 1 ? "" : "s"}`}
          className={cx(
            "relative inline-flex shrink-0 items-center justify-center rounded-full border-2 border-[var(--ui-surface)] bg-slate-200 font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-100",
            sizeClasses[size],
          )}
        >
          +{remaining}
        </span>
      ) : null}
    </span>
  );
}
