/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import {
  pushBucketPathHistory,
  readBucketPathHistory,
} from "./browserPathSuggestions";

type UseBrowserPathHistoryOptions = {
  bucketName: string;
};

export function useBrowserPathHistory({
  bucketName,
}: UseBrowserPathHistoryOptions) {
  const [history, setHistory] = useState(() =>
    readBucketPathHistory(bucketName),
  );

  useEffect(() => {
    setHistory(readBucketPathHistory(bucketName));
  }, [bucketName]);

  const record = useCallback(
    (prefix: string) => {
      if (!bucketName) return;
      setHistory(pushBucketPathHistory(bucketName, prefix));
    },
    [bucketName],
  );

  return { history, record };
}
