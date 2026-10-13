# -*- coding: utf-8 -*-
"""S3 兼容后端（AWS S3 / SeaweedFS / Ceph RGW 等）。凭证走 boto3 标准链（AWS_* 环境变量等）。"""
import asyncio

import boto3
from botocore.exceptions import ClientError

from patent_studio.infra.storage import ObjectNotFound, ObjectRef, object_ref

_MISSING = {"404", "NoSuchKey", "NotFound"}


class S3ObjectStore:
    def __init__(self, bucket: str, prefix: str = "", *, endpoint_url: str | None = None,
                 region: str | None = None) -> None:
        self.bucket = bucket
        self.prefix = f"{prefix}/" if prefix else ""
        self._s3 = boto3.client("s3", endpoint_url=endpoint_url, region_name=region)

    async def put(self, data: bytes, content_type: str) -> ObjectRef:
        ref = object_ref(data, content_type)
        if not await self.exists(ref.key):
            await asyncio.to_thread(self._s3.put_object, Bucket=self.bucket, Key=self.prefix + ref.key,
                                    Body=data, ContentType=content_type)
        return ref

    async def get(self, key: str) -> bytes:
        try:
            obj = await asyncio.to_thread(self._s3.get_object, Bucket=self.bucket, Key=self.prefix + key)
        except ClientError as e:
            if e.response["Error"]["Code"] in _MISSING:
                raise ObjectNotFound(key) from None
            raise
        return await asyncio.to_thread(obj["Body"].read)

    async def exists(self, key: str) -> bool:
        try:
            await asyncio.to_thread(self._s3.head_object, Bucket=self.bucket, Key=self.prefix + key)
        except ClientError as e:
            if e.response["Error"]["Code"] in _MISSING:
                return False
            raise
        return True

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._s3.delete_object, Bucket=self.bucket, Key=self.prefix + key)
