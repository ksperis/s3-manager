# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.services.mappers.bucket_migration import load_migration_json


def test_bucket_migration_mapper_requires_canonical_objects() -> None:
    assert load_migration_json(None) is None
    assert load_migration_json('{"status":"passed"}') == {"status": "passed"}

    for raw in ("{", "[]", '"legacy"'):
        with pytest.raises(ValueError):
            load_migration_json(raw)
