# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.db import PortalStorageSpaceMetadata


def require_no_private_storage_space_ownership(
    db: Session,
    *,
    user_id: int,
    account_id: Optional[int] = None,
) -> None:
    query = db.query(PortalStorageSpaceMetadata.bucket_name).filter(
        PortalStorageSpaceMetadata.owner_user_id == user_id,
        PortalStorageSpaceMetadata.visibility == "private",
    )
    if account_id is not None:
        query = query.filter(PortalStorageSpaceMetadata.account_id == account_id)
    owned_names = [name for (name,) in query.order_by(PortalStorageSpaceMetadata.bucket_name.asc()).limit(4).all()]
    if not owned_names:
        return
    suffix = "" if len(owned_names) < 4 else ", …"
    raise ValueError(
        "Cannot remove Portal access while the user owns private Storage Spaces: "
        f"{', '.join(owned_names)}{suffix}. A Portal manager must take ownership or delete them first."
    )
