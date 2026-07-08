/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import type { LiveS3CredentialsValidationState, S3CredentialsValidationResult } from "./useLiveS3CredentialsValidation";

type S3CredentialsValidationMessageProps = {
  validation: LiveS3CredentialsValidationState;
  className?: string;
};

function validationTone(severity: S3CredentialsValidationResult["severity"]) {
  if (severity === "success") return "success";
  if (severity === "warning") return "warning";
  return "error";
}

export default function S3CredentialsValidationMessage({
  validation,
  className,
}: S3CredentialsValidationMessageProps) {
  if (validation.status === "loading") {
    return (
      <UiInlineMessage tone="info" className={className}>
        Validating credentials...
      </UiInlineMessage>
    );
  }

  if (validation.status === "done" && validation.result) {
    return (
      <UiInlineMessage tone={validationTone(validation.result.severity)} className={className}>
        {validation.result.message}
      </UiInlineMessage>
    );
  }

  return null;
}
