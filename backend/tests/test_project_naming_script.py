# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from pathlib import Path

from scripts.check_project_naming import _searchable_content


FORMER_NAME = "s3" + "manager"


def test_package_lock_integrity_values_are_opaque() -> None:
    content = (
        f'{{"integrity": "sha512-{FORMER_NAME}EncodedValue==", '
        '"name": "bucketreef"}}'
    )

    searchable = _searchable_content(Path("frontend/package-lock.json"), content)

    assert FORMER_NAME not in searchable
    assert '"name": "bucketreef"' in searchable


def test_package_lock_non_integrity_fields_remain_searchable() -> None:
    content = f'{{"name": "{FORMER_NAME}", "integrity": "sha512-safeValue=="}}'

    searchable = _searchable_content(Path("frontend/package-lock.json"), content)

    assert f'"name": "{FORMER_NAME}"' in searchable
    assert "safeValue" not in searchable
