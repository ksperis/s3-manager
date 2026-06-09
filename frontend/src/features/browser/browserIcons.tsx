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

export const BucketCollectionIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M4.2 6.1c0-1.3 2.3-2.4 5.1-2.4s5.1 1.1 5.1 2.4-2.3 2.4-5.1 2.4-5.1-1.1-5.1-2.4Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M4.2 6.1v3.4c0 1.3 2.3 2.4 5.1 2.4s5.1-1.1 5.1-2.4V6.1"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M6.1 12.2v1.6c0 1.2 2 2.2 4.5 2.2s4.5-1 4.5-2.2v-3.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M6.1 12.2c.8.8 2.5 1.3 4.5 1.3 2.5 0 4.5-1 4.5-2.2"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
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

export const TransferIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M6.2 15.8V5.2"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
    />
    <path
      d="m3.9 7.5 2.3-2.3 2.3 2.3"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.8 4.2v10.6"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
    />
    <path
      d="m11.5 12.5 2.3 2.3 2.3-2.3"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M9.8 6.3h2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    <path d="M8.2 13.7h2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
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

export const CutIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="6" cy="14" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7.5 7.5 16 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M7.5 12.5 16 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
    <path d="M5 5.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5 14.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="8" cy="5.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="9" cy="14.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const UserIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <circle cx="10" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M4.5 15.5c1.35-2 3-3 5.5-3s4.15 1 5.5 3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const GroupIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <circle cx="7.2" cy="7.2" r="2.1" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="13" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M3.8 15.2c.9-1.55 2.1-2.35 3.8-2.35 1.65 0 2.85.8 3.75 2.35m1.2-2.1c1.25.1 2.25.8 3 2.1"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ShieldIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M10 3.5 15.5 5.7v4.8c0 2.8-1.85 4.9-5.5 6.3-3.65-1.4-5.5-3.5-5.5-6.3V5.7L10 3.5Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const BellIcon = ({ className = "h-4 w-4", ...props }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M10 4.2a3.2 3.2 0 0 0-3.2 3.2v2.15c0 .9-.35 1.75-1 2.35l-.8.7h10l-.8-.7c-.65-.6-1-1.45-1-2.35V7.4A3.2 3.2 0 0 0 10 4.2Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M8.6 14.5a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
