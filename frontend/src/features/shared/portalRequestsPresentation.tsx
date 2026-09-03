/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiBadge from "../../components/ui/UiBadge";
import type { UiTone } from "../../components/ui/styles";
import type { PortalAdminRequest, PortalAdminRequestStatus, PortalAdminRequestType } from "../../api/portalRequests";

export function portalRequestTypeLabel(type: PortalAdminRequestType): string {
  if (type === "portal_user_access") return "Collaborator access";
  if (type === "portal_user_removal") return "Remove collaborator";
  if (type === "account_quota_change") return "Storage limit";
  return type;
}

function portalRequestStatusLabel(status: PortalAdminRequestStatus): string {
  if (status === "pending") return "Pending";
  if (status === "processing") return "Processing";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "failed") return "Failed";
  return status;
}

function portalRequestStatusTone(status: PortalAdminRequestStatus): UiTone {
  if (status === "approved") return "success";
  if (status === "rejected" || status === "failed") return "danger";
  if (status === "processing") return "warning";
  return "info";
}

export function PortalRequestStatusBadge({ status }: { status: PortalAdminRequestStatus }) {
  return <UiBadge tone={portalRequestStatusTone(status)}>{portalRequestStatusLabel(status)}</UiBadge>;
}

export function portalRequestPayloadSummary(request: PortalAdminRequest): string {
  const payload = request.payload ?? {};
  if (request.request_type === "portal_user_access") {
    const name = typeof payload.target_name === "string" ? payload.target_name : "New user";
    const email = typeof payload.target_email === "string" ? payload.target_email : "";
    return email ? `${name} <${email}>` : name;
  }
  if (request.request_type === "portal_user_removal") {
    const name = typeof payload.target_name === "string" ? payload.target_name : "Portal user";
    const email = typeof payload.target_email === "string" ? payload.target_email : "";
    return email ? `Remove ${name} <${email}>` : `Remove ${name}`;
  }
  if (request.request_type === "account_quota_change") {
    const direction = payload.direction === "decrease" ? "Lower" : "Raise";
    const value = typeof payload.target_quota_value === "number" || typeof payload.target_quota_value === "string"
      ? payload.target_quota_value
      : "";
    const unit = typeof payload.target_quota_unit === "string" ? payload.target_quota_unit : "";
    return `${direction} to ${value} ${unit}`.trim();
  }
  return "-";
}

export function portalRequestReason(request: PortalAdminRequest): string {
  const reason = request.payload?.reason;
  return typeof reason === "string" ? reason : "";
}
