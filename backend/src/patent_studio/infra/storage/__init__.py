# -*- coding: utf-8 -*-
"""对象存储：按内容 SHA-256 寻址的不可变对象。

材料原件、图源、构建产物、Release 冻结件都存这里；数据库只记 ObjectRef。
同一内容只存一份，重复 put 幂等。
"""
import hashlib
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit


class ObjectNotFound(KeyError):
    pass


@dataclass(frozen=True)
class ObjectRef:
    key: str
    sha256: str
    size: int
    content_type: str


def object_ref(data: bytes, content_type: str) -> ObjectRef:
    digest = hashlib.sha256(data).hexdigest()
    return ObjectRef(f"sha256/{digest[:2]}/{digest[2:4]}/{digest}", digest, len(data), content_type)


class ObjectStore(Protocol):
    async def put(self, data: bytes, content_type: str) -> ObjectRef: ...
    async def get(self, key: str) -> bytes: ...
    async def exists(self, key: str) -> bool: ...
    async def delete(self, key: str) -> None: ...


def open_store(url: str, *, s3_endpoint_url: str | None = None, s3_region: str | None = None) -> ObjectStore:
    """file:///abs/dir → 本地目录；s3://bucket[/prefix] → S3 兼容服务。"""
    u = urlsplit(url)
    if u.scheme == "file":
        from patent_studio.infra.storage.fs import FileObjectStore
        return FileObjectStore(u.path)
    if u.scheme == "s3":
        from patent_studio.infra.storage.s3 import S3ObjectStore
        return S3ObjectStore(u.netloc, u.path.strip("/"), endpoint_url=s3_endpoint_url, region=s3_region)
    raise ValueError(f"不支持的对象存储地址：{url!r}")
