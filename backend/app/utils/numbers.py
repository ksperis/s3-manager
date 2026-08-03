# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0


def int_or_zero(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
