/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { SVGProps } from "react";

export default function UiRemoveIcon({ className = "h-3 w-3", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
