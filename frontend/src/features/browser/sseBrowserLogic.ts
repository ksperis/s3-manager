/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type StsSseDecisionInput = {
  stsAvailable: boolean;
  sseActive: boolean;
};

export const shouldUseStsPresigner = ({ stsAvailable, sseActive }: StsSseDecisionInput): boolean =>
  Boolean(stsAvailable && !sseActive);
