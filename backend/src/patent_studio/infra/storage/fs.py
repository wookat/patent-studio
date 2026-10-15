# -*- coding: utf-8 -*-
"""本地目录后端：开发与单机部署。写临时文件后原子改名，读者看不到半个对象。"""

import asyncio
import os
import tempfile
from pathlib import Path

from patent_studio.infra.storage import ObjectNotFound, ObjectRef, object_ref


class FileObjectStore:
    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError(f"非法对象键：{key!r}")
        return path

    def _put(self, data: bytes, ref: ObjectRef) -> None:
        path = self._path(ref.key)
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        except BaseException:
            os.unlink(tmp)
            raise

    async def put(self, data: bytes, content_type: str) -> ObjectRef:
        ref = object_ref(data, content_type)
        await asyncio.to_thread(self._put, data, ref)
        return ref

    async def get(self, key: str) -> bytes:
        try:
            return await asyncio.to_thread(self._path(key).read_bytes)
        except FileNotFoundError:
            raise ObjectNotFound(key) from None

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._path(key).is_file)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._path(key).unlink, missing_ok=True)
