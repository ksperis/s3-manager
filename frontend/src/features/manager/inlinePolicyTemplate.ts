/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const DEFAULT_INLINE_POLICY_TEXT = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:ListAllMyBuckets", "s3:ListBucket", "s3:GetObject"],
        Resource: ["*"],
      },
    ],
  },
  null,
  2
);
