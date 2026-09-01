# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import (
    AccountRole,
    PortalAdminRequest,
    PortalAdminRequestMessage,
    S3Account,
    User,
    UserNotification,
    UserRole,
    UserS3Account,
)
from app.models.portal_requests import (
    PortalAccountQuotaChangeRequestCreate,
    PortalAdminRequestCreate,
    PortalAdminRequestMessageOut,
    PortalAdminRequestOut,
    PortalAdminRequestType,
    PortalUserAccessRequestCreate,
    PortalUserRemovalRequestCreate,
)
from app.models.access_context import AccountAccess
from app.models.s3_account import S3AccountUpdate
from app.core.sensitive_data import sanitize_error_detail
from app.services.audit_service import AuditService
from app.services.s3_accounts_service import S3AccountsService, get_s3_accounts_service
from app.services.portal_service import PortalService
from app.services.users_service import UsersService, get_users_service
from app.utils.size_units import size_to_bytes
from app.utils.time import utcnow


REQUEST_FINAL_STATUSES = {"approved", "rejected", "failed"}
ADMIN_ROLES = {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}
logger = logging.getLogger(__name__)


class PortalRequestNotFound(ValueError):
    pass


class PortalRequestConflict(RuntimeError):
    pass


class PortalRequestExecutionError(RuntimeError):
    pass


class PortalRequestsService:
    def __init__(
        self,
        db: Session,
        *,
        users_service: Optional[UsersService] = None,
        accounts_service: Optional[S3AccountsService] = None,
    ) -> None:
        self.db = db
        self.users_service = users_service or get_users_service(db)
        self.accounts_service = accounts_service or get_s3_accounts_service(db)

    def create_request(
        self,
        actor: User,
        access: AccountAccess,
        payload: PortalAdminRequestCreate,
    ) -> PortalAdminRequestOut:
        request_type, payload_data = self._normalize_create_payload(payload)
        if isinstance(payload, PortalAccountQuotaChangeRequestCreate):
            self._validate_quota_request_against_current_usage(actor, access, payload)
        row = PortalAdminRequest(
            account_id=int(access.account.id),
            requester_user_id=int(actor.id),
            requester_email=actor.email,
            request_type=request_type,
            status="pending",
            payload_json=self._encode_json(payload_data),
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        self._notify_admins(row)
        self.db.commit()
        AuditService(self.db).record_action(
            user=actor,
            scope="portal",
            action="create_portal_request",
            entity_type="portal_request",
            entity_id=str(row.id),
            account=row.account,
            metadata={"request_type": request_type},
        )
        return self.to_out(row)

    def list_for_portal_user(
        self,
        actor: User,
        access: AccountAccess,
        *,
        status: Optional[str] = None,
    ) -> list[PortalAdminRequestOut]:
        query = self.db.query(PortalAdminRequest).filter(
            PortalAdminRequest.account_id == int(access.account.id),
            PortalAdminRequest.requester_user_id == int(actor.id),
        )
        if status:
            query = query.filter(PortalAdminRequest.status == status)
        rows = query.order_by(PortalAdminRequest.created_at.desc(), PortalAdminRequest.id.desc()).all()
        return [self.to_out(row) for row in rows]

    def get_for_portal_user(self, actor: User, access: AccountAccess, request_id: int) -> PortalAdminRequestOut:
        row = (
            self.db.query(PortalAdminRequest)
            .filter(
                PortalAdminRequest.id == int(request_id),
                PortalAdminRequest.account_id == int(access.account.id),
                PortalAdminRequest.requester_user_id == int(actor.id),
            )
            .first()
        )
        if not row:
            raise PortalRequestNotFound("Request not found")
        return self.to_out(row)

    def list_for_admin(
        self,
        *,
        status: Optional[str] = None,
        request_type: Optional[PortalAdminRequestType] = None,
        account_id: Optional[int] = None,
        search: Optional[str] = None,
        limit: int = 200,
    ) -> list[PortalAdminRequestOut]:
        query = self.db.query(PortalAdminRequest)
        if status:
            query = query.filter(PortalAdminRequest.status == status)
        if request_type:
            query = query.filter(PortalAdminRequest.request_type == request_type)
        if account_id is not None:
            query = query.filter(PortalAdminRequest.account_id == int(account_id))
        if search:
            trimmed = search.strip()
            if trimmed:
                pattern = f"%{trimmed}%"
                query = query.outerjoin(S3Account, PortalAdminRequest.account_id == S3Account.id).filter(
                    or_(
                        PortalAdminRequest.requester_email.ilike(pattern),
                        PortalAdminRequest.payload_json.ilike(pattern),
                        S3Account.name.ilike(pattern),
                    )
                )
        rows = (
            query.order_by(PortalAdminRequest.created_at.desc(), PortalAdminRequest.id.desc())
            .limit(max(1, min(int(limit), 500)))
            .all()
        )
        return [self.to_out(row) for row in rows]

    def add_admin_message(
        self,
        request_id: int,
        actor: User,
        message: str,
    ) -> PortalAdminRequestOut:
        row = self._load_request(request_id)
        self._add_message(row, actor, message)
        row.updated_at = utcnow()
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        self._notify_requester(
            row,
            title="Message on your Portal request",
            message=f"{actor.email} replied to your Portal request.",
            event_suffix=f"message:{row.messages[-1].id if row.messages else 'latest'}",
        )
        self.db.commit()
        AuditService(self.db).record_action(
            user=actor,
            scope="admin",
            action="message_portal_request",
            entity_type="portal_request",
            entity_id=str(row.id),
            account=row.account,
            metadata={"request_type": row.request_type},
        )
        return self.to_out(row)

    def reject_request(
        self,
        request_id: int,
        actor: User,
        *,
        message: Optional[str] = None,
    ) -> PortalAdminRequestOut:
        row = self._load_request(request_id)
        self._ensure_pending(row)
        now = utcnow()
        row.status = "rejected"
        row.decided_by_user_id = int(actor.id)
        row.decided_by_email = actor.email
        row.decided_at = now
        row.updated_at = now
        if message:
            self._add_message(row, actor, message)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        self._notify_requester(
            row,
            title="Portal request rejected",
            message="Your Portal request was rejected by a storage admin.",
            event_suffix="rejected",
        )
        self.db.commit()
        AuditService(self.db).record_action(
            user=actor,
            scope="admin",
            action="reject_portal_request",
            entity_type="portal_request",
            entity_id=str(row.id),
            account=row.account,
            metadata={"request_type": row.request_type},
        )
        return self.to_out(row)

    def approve_request(
        self,
        request_id: int,
        actor: User,
        *,
        message: Optional[str] = None,
    ) -> PortalAdminRequestOut:
        row = self._load_request(request_id)
        self._ensure_pending(row)
        row.status = "processing"
        row.updated_at = utcnow()
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)

        try:
            result = self._execute_request(row)
        except Exception as exc:
            detail = sanitize_error_detail(str(exc))
            self.db.rollback()
            failed = self._load_request(request_id)
            now = utcnow()
            failed.status = "failed"
            failed.error_message = detail
            failed.decided_by_user_id = int(actor.id)
            failed.decided_by_email = actor.email
            failed.decided_at = now
            failed.updated_at = now
            self.db.add(failed)
            self.db.commit()
            self._notify_requester(
                failed,
                title="Portal request failed",
                message="A storage admin tried to approve your Portal request, but it could not be completed.",
                event_suffix="failed",
            )
            self.db.commit()
            AuditService(self.db).record_action(
                user=actor,
                scope="admin",
                action="approve_portal_request",
                entity_type="portal_request",
                entity_id=str(failed.id),
                account=failed.account,
                metadata={"request_type": failed.request_type, "error": detail},
                status="failure",
                message=detail,
            )
            raise PortalRequestExecutionError(detail) from exc

        approved = self._load_request(request_id)
        now = utcnow()
        approved.status = "approved"
        approved.result_json = self._encode_json(result)
        approved.error_message = None
        approved.decided_by_user_id = int(actor.id)
        approved.decided_by_email = actor.email
        approved.decided_at = now
        approved.updated_at = now
        if message:
            self._add_message(approved, actor, message)
        self.db.add(approved)
        self.db.commit()
        self.db.refresh(approved)
        self._notify_requester(
            approved,
            title="Portal request approved",
            message="Your Portal request was approved and applied by a storage admin.",
            event_suffix="approved",
        )
        self.db.commit()
        AuditService(self.db).record_action(
            user=actor,
            scope="admin",
            action="approve_portal_request",
            entity_type="portal_request",
            entity_id=str(approved.id),
            account=approved.account,
            metadata={"request_type": approved.request_type, "result": result},
        )
        return self.to_out(approved)

    def to_out(self, row: PortalAdminRequest) -> PortalAdminRequestOut:
        return PortalAdminRequestOut(
            id=int(row.id),
            account_id=int(row.account_id),
            account_name=row.account.name if row.account else None,
            request_type=row.request_type,
            status=row.status,
            payload=self._decode_json(row.payload_json),
            result=self._decode_json(row.result_json) if row.result_json else None,
            error_message=row.error_message,
            requester_user_id=row.requester_user_id,
            requester_email=row.requester_email,
            decided_by_user_id=row.decided_by_user_id,
            decided_by_email=row.decided_by_email,
            decided_at=row.decided_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
            messages=[
                PortalAdminRequestMessageOut(
                    id=int(message.id),
                    author_user_id=message.author_user_id,
                    author_email=message.author_email,
                    author_role=message.author_role,
                    message=message.message,
                    created_at=message.created_at,
                )
                for message in row.messages
            ],
        )

    def _execute_request(self, row: PortalAdminRequest) -> dict[str, Any]:
        if row.request_type == "portal_user_access":
            return self._execute_user_access(row)
        if row.request_type == "portal_user_removal":
            return self._execute_user_removal(row)
        if row.request_type == "account_quota_change":
            return self._execute_quota_change(row)
        raise ValueError("Unsupported Portal request type")

    def _execute_user_access(self, row: PortalAdminRequest) -> dict[str, Any]:
        payload = self._decode_json(row.payload_json)
        target_name = str(payload.get("target_name") or "").strip()
        target_email = str(payload.get("target_email") or "").strip().lower()
        if not target_name or not target_email:
            raise ValueError("Target user name and email are required")

        target = self.users_service.get_by_email_case_insensitive(target_email)
        created_user = False
        if target:
            if not target.is_active:
                raise ValueError("Target user is inactive")
            if target_name and not target.display_name:
                target.display_name = target_name
            if target_name and not target.full_name:
                target.full_name = target_name
            self.db.add(target)
        else:
            target = User(
                email=target_email,
                full_name=target_name,
                display_name=target_name,
                hashed_password=None,
                is_active=True,
                role=UserRole.UI_USER.value,
            )
            self.db.add(target)
            self.db.commit()
            self.db.refresh(target)
            created_user = True

        existing_link = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == row.account_id)
            .first()
        )
        next_account_role = AccountRole.PORTAL_USER.value
        if existing_link and existing_link.role in {
            AccountRole.PORTAL_MANAGER.value,
            AccountRole.ACCOUNT_ADMINISTRATOR.value,
        }:
            next_account_role = existing_link.role
        self.users_service.assign_user_to_account(
            int(target.id),
            int(row.account_id),
            account_root=False,
            role=next_account_role,
        )
        return {
            "target_user_id": int(target.id),
            "target_email": target.email,
            "created_user": created_user,
            "account_role": next_account_role,
        }

    def _execute_user_removal(self, row: PortalAdminRequest) -> dict[str, Any]:
        payload = self._decode_json(row.payload_json)
        target_email = str(payload.get("target_email") or "").strip().lower()
        if not target_email:
            raise ValueError("Target user email is required")

        target = self.users_service.get_by_email_case_insensitive(target_email)
        if not target:
            raise ValueError("Target user was not found")

        link = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id == target.id, UserS3Account.account_id == row.account_id)
            .first()
        )
        if not link:
            raise ValueError("Target user is not linked to this Portal project")
        if link.is_root or link.role == AccountRole.ACCOUNT_ADMINISTRATOR.value:
            raise ValueError("Admin account links cannot be removed through Portal requests")
        if link.role != AccountRole.PORTAL_USER.value:
            raise ValueError("Only Portal user links can be removed through this request")

        removed_role = link.role
        # Revoke the dedicated Portal IAM identity first when one exists, then
        # remove the UI account link. The UI user itself is intentionally kept.
        PortalService(self.db).remove_portal_user(target, row.account)
        self.db.delete(link)
        self.db.commit()
        return {
            "target_user_id": int(target.id),
            "target_email": target.email,
            "removed_account_role": removed_role,
        }

    def _execute_quota_change(self, row: PortalAdminRequest) -> dict[str, Any]:
        payload = self._decode_json(row.payload_json)
        direction = str(payload.get("direction") or "")
        target_value = float(payload.get("target_quota_value"))
        target_unit = str(payload.get("target_quota_unit") or "GiB")
        target_bytes = size_to_bytes(target_value, target_unit)
        current_size_gb, current_objects = self.accounts_service.get_account_quota(row.account)
        current_bytes = size_to_bytes(current_size_gb, "GiB") if current_size_gb is not None else None
        if current_bytes is not None and target_bytes is not None:
            if direction == "increase" and target_bytes <= current_bytes:
                raise ValueError("Requested quota must be greater than the current quota")
            if direction == "decrease" and target_bytes >= current_bytes:
                raise ValueError("Requested quota must be lower than the current quota")
        self.accounts_service.update_account(
            int(row.account_id),
            S3AccountUpdate(
                quota_max_size_gb=target_value,
                quota_max_size_unit=target_unit,
                quota_max_objects=current_objects,
            ),
        )
        return {
            "previous_quota_size_gb": current_size_gb,
            "previous_quota_objects": current_objects,
            "target_quota_value": target_value,
            "target_quota_unit": target_unit,
            "target_quota_bytes": target_bytes,
        }

    def _validate_quota_request_against_current_usage(
        self,
        actor: User,
        access: AccountAccess,
        payload: PortalAccountQuotaChangeRequestCreate,
    ) -> None:
        target_bytes = size_to_bytes(payload.target_quota_value, payload.target_quota_unit)
        if target_bytes is None:
            return
        try:
            usage = PortalService(self.db).get_usage(actor, access)
        except Exception as exc:  # noqa: BLE001 - usage may be unavailable on degraded RGW paths.
            logger.warning("Unable to validate Portal quota request against usage: %s", exc)
            return
        used_bytes = getattr(usage, "used_bytes", None)
        if used_bytes is not None and target_bytes < int(used_bytes):
            raise ValueError("Requested quota cannot be lower than the space already used")

    def _load_request(self, request_id: int) -> PortalAdminRequest:
        row = self.db.query(PortalAdminRequest).filter(PortalAdminRequest.id == int(request_id)).first()
        if not row:
            raise PortalRequestNotFound("Request not found")
        return row

    def _ensure_pending(self, row: PortalAdminRequest) -> None:
        if row.status != "pending":
            if row.status == "processing":
                raise PortalRequestConflict("Request is already being processed")
            if row.status in REQUEST_FINAL_STATUSES:
                raise PortalRequestConflict("Request has already been decided")
            raise PortalRequestConflict("Request cannot be modified")

    def _add_message(self, row: PortalAdminRequest, actor: User, message: str) -> None:
        clean_message = " ".join(str(message).split())
        if not clean_message:
            return
        row.messages.append(
            PortalAdminRequestMessage(
                request_id=int(row.id),
                author_user_id=int(actor.id),
                author_email=actor.email,
                author_role=actor.role,
                message=clean_message,
                created_at=utcnow(),
            )
        )

    def _notify_admins(self, row: PortalAdminRequest) -> None:
        admins = (
            self.db.query(User)
            .filter(User.is_active.is_(True), User.role.in_(ADMIN_ROLES))
            .all()
        )
        for admin in admins:
            self._add_notification(
                user_id=int(admin.id),
                title="New Portal request",
                message=f"{row.requester_email} submitted a Portal request.",
                event_key=f"portal_request:{row.id}:created:{admin.id}",
                severity="info",
                payload={"request_id": row.id, "request_type": row.request_type, "account_id": row.account_id},
            )

    def _notify_requester(
        self,
        row: PortalAdminRequest,
        *,
        title: str,
        message: str,
        event_suffix: str,
    ) -> None:
        if not row.requester_user_id:
            return
        self._add_notification(
            user_id=int(row.requester_user_id),
            title=title,
            message=message,
            event_key=f"portal_request:{row.id}:{event_suffix}",
            severity="info" if row.status != "failed" else "warning",
            payload={"request_id": row.id, "request_type": row.request_type, "status": row.status},
        )

    def _add_notification(
        self,
        *,
        user_id: int,
        title: str,
        message: str,
        event_key: str,
        severity: str,
        payload: dict[str, Any],
    ) -> None:
        exists = (
            self.db.query(UserNotification.id)
            .filter(UserNotification.user_id == int(user_id), UserNotification.event_key == event_key)
            .first()
        )
        if exists:
            return
        self.db.add(
            UserNotification(
                user_id=int(user_id),
                notification_type="portal_request",
                severity=severity,
                title=title,
                message=message,
                subject_type=None,
                event_key=event_key,
                payload_json=self._encode_json(payload),
                created_at=utcnow(),
            )
        )

    def _normalize_create_payload(self, payload: PortalAdminRequestCreate) -> tuple[str, dict[str, Any]]:
        if isinstance(payload, PortalUserAccessRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        if isinstance(payload, PortalUserRemovalRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        if isinstance(payload, PortalAccountQuotaChangeRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        raise ValueError("Unsupported Portal request payload")

    @staticmethod
    def _encode_json(payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=True, sort_keys=True)

    @staticmethod
    def _decode_json(raw: str) -> dict[str, Any]:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("Portal request JSON must be an object")
        return parsed


def get_portal_requests_service(db: Session) -> PortalRequestsService:
    return PortalRequestsService(db)
