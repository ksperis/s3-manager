# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base
from .enums import AccountRole


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("name", name="uq_projects_name"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    portal_settings_override = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account_links = relationship("ProjectS3Account", back_populates="project", cascade="all, delete-orphan")
    user_links = relationship("UserProject", back_populates="project", cascade="all, delete-orphan")
    group_links = relationship("UiGroupProject", back_populates="project", cascade="all, delete-orphan")
    project_iam_links = relationship("ProjectIAMUser", back_populates="project", cascade="all, delete-orphan")


class ProjectS3Account(Base):
    __tablename__ = "project_s3_accounts"
    __table_args__ = (
        UniqueConstraint("project_id", "account_id", name="uq_project_s3_account"),
        Index("ix_project_s3_accounts_account_project", "account_id", "project_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="CASCADE"), nullable=False)
    display_name = Column(String, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    project = relationship("Project", back_populates="account_links")
    account = relationship("S3Account", back_populates="project_links")


class ProjectIAMUser(Base):
    __tablename__ = "project_iam_users"
    __table_args__ = (
        UniqueConstraint("user_id", "project_id", "zonegroup_key", name="uq_project_iam_user_scope"),
        Index("ix_project_iam_users_project_user", "project_id", "user_id"),
        Index("ix_project_iam_users_authority_account", "authority_account_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    zonegroup_key = Column(String, nullable=False)
    zonegroup_name = Column(String, nullable=True)
    authority_account_id = Column(Integer, ForeignKey("s3_accounts.id", ondelete="SET NULL"), nullable=True)
    iam_user_id = Column(String, nullable=False)
    iam_username = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User")
    project = relationship("Project", back_populates="project_iam_links")
    authority_account = relationship("S3Account")


class UserProject(Base):
    __tablename__ = "user_projects"
    __table_args__ = (
        UniqueConstraint("user_id", "project_id", name="uq_user_project"),
        Index("ix_user_projects_project_user", "project_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_role = Column(
        String,
        nullable=False,
        default=AccountRole.PORTAL_USER.value,
        server_default=AccountRole.PORTAL_USER.value,
    )
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User", back_populates="project_links")
    project = relationship("Project", back_populates="user_links")


class UiGroupProject(Base):
    __tablename__ = "ui_group_projects"
    __table_args__ = (
        UniqueConstraint("group_id", "project_id", name="uq_ui_group_project"),
        Index("ix_ui_group_projects_project_group", "project_id", "group_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("ui_groups.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_role = Column(
        String,
        nullable=False,
        default=AccountRole.PORTAL_USER.value,
        server_default=AccountRole.PORTAL_USER.value,
    )
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    group = relationship("UiGroup", back_populates="project_links")
    project = relationship("Project", back_populates="group_links")
