# -*- coding: utf-8 -*-
"""平台 HTTP API 层。B3 批含 auth_routes + /api/v1 org/case 面（routes.py）；
其余域面（documents/proposals/releases/materials/runs…）随后续批次并入。"""

from patent_studio.api.routes import router

__all__ = ["router"]
