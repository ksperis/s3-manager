/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { SVGProps } from "react";

export default function CephStorageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <ellipse cx="12" cy="6.5" rx="6.5" ry="2.7" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5.5 6.5v5.5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5.5 12v5.5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V12" />
    </svg>
  );
}
