# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Reconcile Portal IAM identities from canonical database access roles."""

from __future__ import annotations

import argparse
import json
import logging

from app.core.database import SessionLocal
from app.db import AccountIAMUser, S3Account, User
from app.services.effective_access_service import EffectiveAccessService
from app.services.portal_service import PortalService

logger = logging.getLogger(__name__)


def _portal_compatible(account: S3Account) -> bool:
    return EffectiveAccessService.portal_account_is_compatible(account)


def reconcile_portal_iam(*, dry_run: bool = True, account_id: int | None = None) -> list[dict[str, object]]:
    db = SessionLocal()
    summaries: list[dict[str, object]] = []
    try:
        query = db.query(S3Account).order_by(S3Account.id.asc())
        if account_id is not None:
            query = query.filter(S3Account.id == account_id)
        accounts = query.all()
        all_users = db.query(User).order_by(User.id.asc()).all()
        users = [user for user in all_users if user.is_active]
        users_by_id = {int(user.id): user for user in all_users}
        service = EffectiveAccessService(db)
        resolved_by_user = {int(user.id): service.resolve_user(user) for user in users}
        portal = PortalService(db)

        for account in accounts:
            summary: dict[str, object] = {
                "account_id": int(account.id),
                "account": account.name,
                "compatible": _portal_compatible(account),
                "planned": 0,
                "reconciled": 0,
                "removed": 0,
                "errors": [],
            }
            if not summary["compatible"]:
                summaries.append(summary)
                continue

            desired: dict[int, str] = {}
            for user in users:
                link = resolved_by_user[int(user.id)].account_link_for(int(account.id))
                if link is not None and link.portal_role is not None:
                    desired[int(user.id)] = link.portal_role
            existing_user_ids = {
                int(value)
                for (value,) in db.query(AccountIAMUser.user_id).filter(AccountIAMUser.account_id == account.id).all()
            }
            target_ids = sorted(set(desired) | existing_user_ids)
            summary["planned"] = len(target_ids)
            for user_id in target_ids:
                role = desired.get(user_id)
                target = users_by_id.get(user_id)
                if target is None:
                    errors = summary["errors"]
                    assert isinstance(errors, list)
                    errors.append({"user_id": user_id, "error": "UI user not found"})
                    continue
                if dry_run:
                    continue
                try:
                    if role is None:
                        portal.sync_existing_portal_user_access(target, account, None)
                        summary["removed"] = int(summary["removed"]) + 1
                    else:
                        portal.provision_portal_user(target, account, role)
                        summary["reconciled"] = int(summary["reconciled"]) + 1
                    db.commit()
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    errors = summary["errors"]
                    assert isinstance(errors, list)
                    errors.append({"user_id": user_id, "error": str(exc)})
            summaries.append(summary)
        return summaries
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconcile Portal IAM identities from canonical access roles.")
    parser.add_argument("--apply", action="store_true", help="Apply changes. Without this flag, only a dry-run is performed.")
    parser.add_argument("--account-id", type=int, help="Limit reconciliation to one database account id.")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    summaries = reconcile_portal_iam(dry_run=not args.apply, account_id=args.account_id)
    logger.info("mode=%s", "apply" if args.apply else "dry-run")
    for summary in summaries:
        logger.info("%s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
