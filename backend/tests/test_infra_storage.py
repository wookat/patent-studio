# -*- coding: utf-8 -*-
"""对象存储：内容寻址、幂等、缺失语义；本地目录、S3（moto）与真实 S3 兼容服务同一套断言。

真实服务可选：PATENT_STUDIO_TEST_S3_ENDPOINT（如本地 SeaweedFS http://127.0.0.1:8333），未设置则跳过。
"""
import asyncio
import hashlib
import os
import uuid

import boto3
import pytest
from moto import mock_aws

from patent_studio.infra.storage import ObjectNotFound, open_store
from patent_studio.infra.storage.fs import FileObjectStore

DATA = "权利要求1。".encode()


LIVE_S3 = os.environ.get("PATENT_STUDIO_TEST_S3_ENDPOINT")


@pytest.fixture(params=["file", "s3-moto", "s3-live"])
def store(request, tmp_path, monkeypatch):
    if request.param == "file":
        yield open_store(f"file://{tmp_path}")
        return
    creds = {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test", "AWS_DEFAULT_REGION": "us-east-1"}
    for k, v in creds.items():
        monkeypatch.setenv(k, v)
    if request.param == "s3-moto":
        with mock_aws():
            boto3.client("s3").create_bucket(Bucket="patent-studio")
            yield open_store("s3://patent-studio/objects")
        return
    if not LIVE_S3:
        pytest.skip("未设置 PATENT_STUDIO_TEST_S3_ENDPOINT")
    s3 = boto3.client("s3", endpoint_url=LIVE_S3)
    bucket, prefix = "patent-studio-test", f"run-{uuid.uuid4().hex}"
    try:
        s3.create_bucket(Bucket=bucket)
    except s3.exceptions.BucketAlreadyOwnedByYou:
        pass
    yield open_store(f"s3://{bucket}/{prefix}", s3_endpoint_url=LIVE_S3)
    for obj in s3.list_objects_v2(Bucket=bucket, Prefix=prefix).get("Contents", []):
        s3.delete_object(Bucket=bucket, Key=obj["Key"])


def test_put_get_is_content_addressed_and_idempotent(store):
    async def run():
        ref = await store.put(DATA, "text/markdown")
        again = await store.put(DATA, "text/markdown")
        return ref, again, await store.get(ref.key), await store.exists(ref.key)

    ref, again, body, exists = asyncio.run(run())
    digest = hashlib.sha256(DATA).hexdigest()
    assert ref == again
    assert (ref.sha256, ref.size, ref.key) == (digest, len(DATA), f"sha256/{digest[:2]}/{digest[2:4]}/{digest}")
    assert body == DATA and exists


def test_missing_and_delete(store):
    async def run():
        ref = await store.put(DATA, "text/plain")
        await store.delete(ref.key)
        await store.delete(ref.key)
        assert not await store.exists(ref.key)
        with pytest.raises(ObjectNotFound):
            await store.get(ref.key)

    asyncio.run(run())


def test_file_store_rejects_escaping_keys(tmp_path):
    with pytest.raises(ValueError):
        asyncio.run(FileObjectStore(tmp_path / "objects").get("../outside"))


def test_file_store_leaves_no_temp_files(tmp_path):
    asyncio.run(FileObjectStore(tmp_path).put(DATA, "text/plain"))
    names = [n for _, _, files in os.walk(tmp_path) for n in files]
    assert names == [hashlib.sha256(DATA).hexdigest()]


def test_open_store_rejects_unknown_scheme():
    with pytest.raises(ValueError):
        open_store("ftp://x/y")
