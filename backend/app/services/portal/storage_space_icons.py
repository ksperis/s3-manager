# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote

from app.db import PortalAccountRole, PortalStorageSpaceMetadata, User
from app.models.portal_storage_spaces import (
    PortalStorageSpaceIcon,
    PortalStorageSpaceIconPreset,
    PortalStorageSpaceIconSource,
)
from app.services.avatar_image_service import ALLOWED_AVATAR_CONTENT_TYPES, validate_avatar_image
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


STORAGE_SPACE_ICON_PRESETS = {"bucket", "folder", "archive", "database", "media"}


class PortalStorageSpaceIconsMixin:
    def _storage_space_icon_descriptor(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> PortalStorageSpaceIcon:
        if metadata is None:
            return PortalStorageSpaceIcon()
        updated_at = metadata.icon_updated_at
        source = str(metadata.icon_source or "preset")
        if (
            source == "uploaded"
            and metadata.icon_image
            and metadata.icon_content_type in ALLOWED_AVATAR_CONTENT_TYPES
        ):
            version = int(updated_at.timestamp() * 1_000_000) if updated_at else 0
            encoded_space_id = quote(metadata.bucket_name, safe="")
            return PortalStorageSpaceIcon(
                source="uploaded",
                preset=None,
                url=(
                    f"/portal/storage-spaces/{encoded_space_id}/icon/image"
                    f"?account_id={metadata.account_id}&v={version}"
                ),
                updated_at=updated_at,
            )
        preset = str(metadata.icon_preset or "bucket")
        if preset not in STORAGE_SPACE_ICON_PRESETS:
            preset = "bucket"
        return PortalStorageSpaceIcon(
            source="preset",
            preset=preset,
            updated_at=updated_at,
        )

    def _visible_storage_space_icon_metadata(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceMetadata:
        metadata = self._storage_space_metadata(access.account, space_id)
        if metadata is None:
            raise RuntimeError("Storage space icon not found or not allowed.")
        visible = self._storage_space_roles_by_bucket(
            user,
            access.account,
            access.portal_role,
            include_archived=True,
        )
        if metadata.bucket_name not in visible:
            raise RuntimeError("Storage space icon not found or not allowed.")
        return metadata

    def set_storage_space_icon_choice(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        source: PortalStorageSpaceIconSource,
        preset: PortalStorageSpaceIconPreset | None = None,
    ) -> PortalStorageSpaceIcon:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Only project managers can configure Storage Space icons.")
        metadata = self._visible_storage_space_icon_metadata(user, access, space_id)
        if source == "uploaded":
            if not metadata.icon_image:
                raise ValueError("Upload a Storage Space image before selecting it.")
        else:
            if preset not in STORAGE_SPACE_ICON_PRESETS:
                raise ValueError("Select a valid Storage Space pictogram.")
            metadata.icon_preset = preset
        metadata.icon_source = source
        metadata.icon_updated_at = utcnow()
        self.db.add(metadata)
        self.db.commit()
        self.db.refresh(metadata)
        return self._storage_space_icon_descriptor(metadata)

    def store_storage_space_icon_image(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        payload: bytes,
        content_type: str | None,
    ) -> PortalStorageSpaceIcon:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Only project managers can configure Storage Space icons.")
        metadata = self._visible_storage_space_icon_metadata(user, access, space_id)
        detected_type = validate_avatar_image(payload, content_type)
        metadata.icon_image = payload
        metadata.icon_content_type = detected_type
        metadata.icon_source = "uploaded"
        metadata.icon_updated_at = utcnow()
        self.db.add(metadata)
        self.db.commit()
        self.db.refresh(metadata)
        return self._storage_space_icon_descriptor(metadata)

    def remove_storage_space_icon_image(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceIcon:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Only project managers can configure Storage Space icons.")
        metadata = self._visible_storage_space_icon_metadata(user, access, space_id)
        metadata.icon_image = None
        metadata.icon_content_type = None
        metadata.icon_source = "preset"
        metadata.icon_updated_at = utcnow()
        self.db.add(metadata)
        self.db.commit()
        self.db.refresh(metadata)
        return self._storage_space_icon_descriptor(metadata)

    def storage_space_icon_image(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> tuple[bytes, str, str]:
        metadata = self._visible_storage_space_icon_metadata(user, access, space_id)
        if not metadata.icon_image or metadata.icon_content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
            raise RuntimeError("Storage space icon not found or not allowed.")
        version = str(
            int(metadata.icon_updated_at.timestamp() * 1_000_000)
            if metadata.icon_updated_at
            else 0
        )
        return bytes(metadata.icon_image), str(metadata.icon_content_type), version
