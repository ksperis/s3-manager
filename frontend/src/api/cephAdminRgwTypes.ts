/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type CephAdminRgwQuotaConfig = {
  enabled?: boolean | null;
  max_size_bytes?: number | null;
  max_objects?: number | null;
};
