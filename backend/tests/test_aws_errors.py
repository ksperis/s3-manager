# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from botocore.exceptions import ClientError

from app.utils.aws_errors import aws_error_code


def test_aws_error_code_normalizes_client_error_code_on_request():
    error = ClientError(
        {"Error": {"Code": " AccessDenied ", "Message": "denied"}},
        "ListObjectsV2",
    )

    assert aws_error_code(error) == "AccessDenied"
    assert aws_error_code(error, lowercase=True) == "accessdenied"
    assert aws_error_code(RuntimeError("failed")) == ""
