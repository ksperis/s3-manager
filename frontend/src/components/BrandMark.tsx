/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ImgHTMLAttributes } from "react";

import { PRODUCT_MARK_URL } from "../constants/product";

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export default function BrandMark({ alt = "", className = "", ...props }: BrandMarkProps) {
  return (
    <img
      src={PRODUCT_MARK_URL}
      alt={alt}
      className={`block shrink-0 object-contain ${className}`.trim()}
      draggable={false}
      {...props}
    />
  );
}
