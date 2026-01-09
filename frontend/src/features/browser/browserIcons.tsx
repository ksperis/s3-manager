/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

export const FolderIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M2.5 6.5a2 2 0 0 1 2-2h3l1.6 1.6a2 2 0 0 0 1.4.6H15.5a2 2 0 0 1 2 2v5.6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8.8Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

export const FolderPlusIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M2.5 6.5a2 2 0 0 1 2-2h3l1.6 1.6a2 2 0 0 0 1.4.6H15.5a2 2 0 0 1 2 2v5.6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8.8Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path d="M10 9.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M7.5 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const FileIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M5 3.5h5.6L15.5 8v8.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16.5v-11A2 2 0 0 1 5.5 3.5Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path d="M10.6 3.5V7a1 1 0 0 0 1 1h3.4" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const BucketIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <ellipse cx="10" cy="5.5" rx="6.5" ry="2.8" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M3.5 5.5v6.5c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3V5.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

export const OpenIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M7 5h8v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="m7 13 8-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const EyeIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M2.5 10s2.8-4.5 7.5-4.5S17.5 10 17.5 10s-2.8 4.5-7.5 4.5S2.5 10 2.5 10Z"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const DownloadIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M10 3.5v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="m6.5 9.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M4 15.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const UploadIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M10 16.5v-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="m6.5 10.5 3.5-3.5 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M4 4.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const RefreshIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M16 10a6 6 0 1 1-2.1-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M12.5 3.5h3.5v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const UpIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M9 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 8h6a4 4 0 0 1 4 4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const CopyIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <rect x="7" y="7" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <rect x="4" y="4" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const LinkIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M8 6h-2.5a3 3 0 1 0 0 6H8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="M12 6h2.5a3 3 0 1 1 0 6H12"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path d="M7.5 10h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const PasteIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <rect x="6.5" y="3" width="7" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="4.5" y="6" width="11" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const InfoIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
    <path d="M10 9v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="10" cy="6.5" r="1" fill="currentColor" />
  </svg>
);

export const SlidersIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M5 5.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5 14.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="8" cy="5.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="9" cy="14.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const HistoryIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M4 10a6 6 0 1 0 2-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M4 5v3.5h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 6.5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const SettingsIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M8.3 3.5h3.4l.6 1.9 2 .8 1.6-1 2.4 2.4-1 1.6.8 2 .9.3v3.4l-.9.3-.8 2 1 1.6-2.4 2.4-1.6-1-2 .8-.6 1.9H8.3l-.6-1.9-2-.8-1.6 1-2.4-2.4 1-1.6-.8-2-.9-.3V10l.9-.3.8-2-1-1.6L4.7 3.7l1.6 1 2-.8.6-1.9Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const TrashIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M4.5 6.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M8 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6.5 6.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const MoreIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden="true" {...props}>
    <circle cx="6" cy="10" r="1.4" />
    <circle cx="10" cy="10" r="1.4" />
    <circle cx="14" cy="10" r="1.4" />
  </svg>
);

export const SearchIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const ListIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M4 6h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M4 14h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const CompactIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="M4 5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M4 8.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M4 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M4 15.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const GridIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="11" y="3.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="3.5" y="11" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="11" y="11" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const ChevronDownIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path d="m5 7 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
