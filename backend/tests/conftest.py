# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool

from app.db_models import Base, S3Account, StorageEndpoint, User, UserRole
from app.main import app
from app.routers import dependencies


@pytest.fixture(scope="session")
def test_engine():
    # Use in-memory sqlite
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


@pytest.fixture(scope="session")
def tables(test_engine):
    Base.metadata.create_all(bind=test_engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = SessionLocal()
    try:
        existing_default = (
            session.query(StorageEndpoint)
            .filter(StorageEndpoint.is_default.is_(True))
            .order_by(StorageEndpoint.id.asc())
            .first()
        )
        if not existing_default:
            session.add(
                StorageEndpoint(
                    name="default-test",
                    endpoint_url="http://localhost:8000",
                    provider="ceph",
                    admin_access_key="AK",
                    admin_secret_key="SK",
                    features_config="features:\n  admin:\n    enabled: true\n",
                    is_default=True,
                    is_editable=True,
                )
            )
            session.commit()
    finally:
        session.close()
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session(test_engine, tables):
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    # Fake current users
    def override_super_admin():
        return User(
            id=999,
            email="admin@example.com",
            full_name="Admin",
            hashed_password="x",
            is_active=True,
            role=UserRole.UI_ADMIN.value,
        )

    def override_account_admin():
        return User(
            id=1000,
            email="manager@example.com",
            full_name="Manager",
            hashed_password="x",
            is_active=True,
            role=UserRole.UI_USER.value,
        )

    app.dependency_overrides[dependencies.get_db] = override_get_db
    app.dependency_overrides[dependencies.get_current_super_admin] = override_super_admin
    app.dependency_overrides[dependencies.get_current_account_admin] = override_account_admin
    app.dependency_overrides[dependencies.get_current_account_user] = override_account_admin
    app.dependency_overrides[dependencies.get_current_actor] = override_account_admin

    yield TestClient(app)

    app.dependency_overrides = {}
