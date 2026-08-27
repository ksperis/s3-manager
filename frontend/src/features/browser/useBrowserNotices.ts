/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";

type UseBrowserNoticesOptions = {
  scopeKey: string;
};

export function useBrowserNotices({ scopeKey }: UseBrowserNoticesOptions) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  useEffect(() => {
    setStatusMessage(null);
    setWarningMessage(null);
  }, [scopeKey]);

  return {
    setStatusMessage,
    setWarningMessage,
    statusMessage,
    warningMessage,
  };
}
