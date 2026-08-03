# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from botocore.exceptions import ClientError

from app.utils.s3_errors import format_s3_error


def _client_error(code, message, operation: str = "ListObjectsV2") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, operation)


def test_format_s3_error_preserves_operation_as_an_explicit_option():
    error = _client_error("AccessDenied", "denied")

    assert format_s3_error(error) == "AccessDenied: denied"
    assert format_s3_error(error, include_operation=True) == "ListObjectsV2 failed with AccessDenied: denied"


def test_format_s3_error_falls_back_to_plain_exception_text():
    assert format_s3_error(RuntimeError("storage unavailable"), include_operation=True) == "storage unavailable"
