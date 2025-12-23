# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

def grant_read_caps() -> None:
    logger.warning("RGW capability provisioning has been removed; no action taken.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    grant_read_caps()
