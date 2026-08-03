# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime, timezone

from pydantic import BaseModel

from app.utils.jsonable import model_to_jsonable


class _Payload(BaseModel):
    created_at: datetime


def test_model_to_jsonable_serializes_pydantic_models_in_json_mode():
    value = _Payload(created_at=datetime(2026, 8, 3, 12, 30, tzinfo=timezone.utc))

    assert model_to_jsonable(value) == {"created_at": "2026-08-03T12:30:00Z"}


def test_model_to_jsonable_preserves_non_model_values():
    payload = {"enabled": True}

    assert model_to_jsonable(None) is None
    assert model_to_jsonable(payload) is payload
