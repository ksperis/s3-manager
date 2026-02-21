# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, User, UserRole
from app.main import app
from app.routers import dependencies


@pytest.fixture(scope="session")
def test_engine():
    # Shared in-memory sqlite database for the whole test session.
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


@pytest.fixture
def db_session(test_engine):
    # Full schema reset per test to avoid order-dependent state leaks.
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

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

    yield TestClient(app)

    app.dependency_overrides = {}
