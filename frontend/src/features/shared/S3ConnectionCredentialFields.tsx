/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInput from "../../components/ui/UiInput";
import { cx } from "../../components/ui/styles";

type S3ConnectionCredentialFieldsProps = {
  accessKeyId: string;
  secretAccessKey: string;
  onAccessKeyIdChange: (value: string) => void;
  onSecretAccessKeyChange: (value: string) => void;
  required?: boolean;
  accessKeyLabel?: string;
  secretAccessKeyLabel?: string;
  accessKeyPlaceholder?: string;
  secretAccessKeyPlaceholder?: string;
  className?: string;
};

export default function S3ConnectionCredentialFields({
  accessKeyId,
  secretAccessKey,
  onAccessKeyIdChange,
  onSecretAccessKeyChange,
  required = false,
  accessKeyLabel,
  secretAccessKeyLabel,
  accessKeyPlaceholder = "AKIA...",
  secretAccessKeyPlaceholder = "********",
  className,
}: S3ConnectionCredentialFieldsProps) {
  const resolvedAccessKeyLabel = accessKeyLabel || `Access key ID${required ? " *" : ""}`;
  const resolvedSecretAccessKeyLabel = secretAccessKeyLabel || `Secret access key${required ? " *" : ""}`;

  return (
    <div className={cx("grid grid-cols-1 gap-4 sm:grid-cols-2", className)}>
      <UiInput
        label={resolvedAccessKeyLabel}
        value={accessKeyId}
        onChange={(event) => onAccessKeyIdChange(event.target.value)}
        placeholder={accessKeyPlaceholder}
        required={required}
      />
      <UiInput
        label={resolvedSecretAccessKeyLabel}
        type="password"
        value={secretAccessKey}
        onChange={(event) => onSecretAccessKeyChange(event.target.value)}
        placeholder={secretAccessKeyPlaceholder}
        required={required}
      />
    </div>
  );
}
