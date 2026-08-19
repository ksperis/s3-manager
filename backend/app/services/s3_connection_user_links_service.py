# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy.orm import Session

from app.db.s3_connection import UserS3Connection
from app.db.user import User
from app.services.s3_connections_service import S3ConnectionsService
from app.utils.time import utcnow


class S3ConnectionUserLinksError(Exception):
    pass


class S3ConnectionUserNotFoundError(S3ConnectionUserLinksError):
    pass


class S3ConnectionUserLinkNotFoundError(S3ConnectionUserLinksError):
    pass


class S3ConnectionUserLinksService:
    """Lifecycle boundary for direct UI-user links to shared connections."""

    def __init__(self, db: Session):
        self.db = db
        self.connections = S3ConnectionsService(db)

    def list_for_admin_shared(
        self,
        connection_id: int,
    ) -> list[tuple[UserS3Connection, User]]:
        self.connections.get_admin_shared(connection_id)
        return (
            self.db.query(UserS3Connection, User)
            .join(User, User.id == UserS3Connection.user_id)
            .filter(UserS3Connection.s3_connection_id == connection_id)
            .order_by(User.email.asc())
            .all()
        )

    def upsert_for_admin_shared(
        self,
        connection_id: int,
        user_id: int,
    ) -> tuple[UserS3Connection, User, bool]:
        self.connections.get_admin_shared(connection_id)
        user = self.db.query(User).filter(User.id == user_id).first()
        if user is None:
            raise S3ConnectionUserNotFoundError("User not found")
        link = self._find_link(connection_id, user_id)
        created = link is None
        now = utcnow()
        if link is None:
            link = UserS3Connection(
                user_id=user_id,
                s3_connection_id=connection_id,
                created_at=now,
                updated_at=now,
            )
            self.db.add(link)
        else:
            link.updated_at = now
        self.db.commit()
        self.db.refresh(link)
        return link, user, created

    def remove_for_admin_shared(
        self,
        connection_id: int,
        user_id: int,
    ) -> None:
        self.connections.get_admin_shared(connection_id)
        link = self._find_link(connection_id, user_id)
        if link is None:
            raise S3ConnectionUserLinkNotFoundError("Link not found")
        self.db.delete(link)
        self.db.commit()

    def _find_link(
        self,
        connection_id: int,
        user_id: int,
    ) -> UserS3Connection | None:
        return (
            self.db.query(UserS3Connection)
            .filter(
                UserS3Connection.user_id == user_id,
                UserS3Connection.s3_connection_id == connection_id,
            )
            .first()
        )
