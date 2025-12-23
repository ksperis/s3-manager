# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool

from app.db_models import Base, User, UserRole, S3Account
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
            role=UserRole.SUPER_ADMIN.value,
        )

    def override_account_admin():
        return User(
            id=1000,
            email="manager@example.com",
            full_name="Manager",
            hashed_password="x",
            is_active=True,
            role=UserRole.ACCOUNT_ADMIN.value,
        )

    app.dependency_overrides[dependencies.get_db] = override_get_db
    app.dependency_overrides[dependencies.get_current_super_admin] = override_super_admin
    app.dependency_overrides[dependencies.get_current_account_admin] = override_account_admin

    yield TestClient(app)

    app.dependency_overrides = {}
