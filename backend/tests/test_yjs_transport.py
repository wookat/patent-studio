"""Real PostgreSQL-backed Yjs WebSocket transport checks."""

import asyncio
import contextlib
import socket
import threading
import time
import uuid

import uvicorn
import websockets
from fastapi.testclient import TestClient
from pycrdt import Doc, Provider, Text, YMessageType, YSyncMessageType
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from test_auth import _login, _register
from test_infra_rest_proposal_release import _ref

from patent_studio.domain.collab import CollabUpdate
from patent_studio.infra.db import database_url
from patent_studio.settings import get_settings

pytest_plugins = ("test_auth",)


class Channel:
    def __init__(self, websocket):
        self.websocket = websocket
        self.synced = False
        self.path = "working-copy"

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            message = await self.websocket.recv()
        except websockets.ConnectionClosed:
            raise StopAsyncIteration()
        if message[0] == YMessageType.SYNC and message[1] == YSyncMessageType.SYNC_STEP2:
            self.synced = True
        if message[0] == YMessageType.SYNC:
            self.last_sync_type = message[1]
        return message

    async def send(self, message):
        await self.websocket.send(message)

    async def recv(self):
        return await self.websocket.recv()


async def _wait(predicate, timeout=5):
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "Yjs sync timed out"
        await asyncio.sleep(0.02)


@contextlib.asynccontextmanager
async def _client(base, working_copy_id, cookie):
    doc = Doc()
    text = Text()
    doc["content"] = text
    headers = {"Cookie": f"studio_session={cookie}"}
    async with websockets.connect(
        f"{base.replace('http://', 'ws://')}/api/v1/working-copies/{working_copy_id}/collab",
        additional_headers=headers,
    ) as websocket:
        channel = Channel(websocket)
        async with Provider(doc, channel):
            await _wait(lambda: channel.synced)
            yield text


@contextlib.contextmanager
def _server(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="off"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        assert time.monotonic() < deadline
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(10)


def _prepare(client):
    organization = client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": f"yjs-org-{uuid.uuid4().hex}"},
        json={"slug": f"yjs-{uuid.uuid4().hex[:8]}", "name": "Yjs"},
    ).json()
    case = client.post(
        f"/api/v1/organizations/{organization['id']}/cases",
        headers={"Idempotency-Key": f"yjs-case-{uuid.uuid4().hex}"},
        json={"case_key": "YJS-1", "title": "Yjs", "kind": "invention"},
    ).json()
    document = client.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Idempotency-Key": f"yjs-doc-{uuid.uuid4().hex}"},
        json={"book": "claims"},
    ).json()
    client.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": f"yjs-rev-{uuid.uuid4().hex}"},
        json={"content_ref": _ref("claims")},
    )
    working_copy = client.post(
        f"/api/v1/documents/{document['id']}/working-copies",
        headers={"Idempotency-Key": f"yjs-wc-{uuid.uuid4().hex}"},
        json={},
    ).json()
    return case, working_copy


def test_yjs_two_clients_persist_reconnect_flush_and_barrier(on):
    setup = TestClient(on.app)
    email = f"yjs-{uuid.uuid4().hex[:10]}@example.com"
    _register(setup, email)
    client = _login(on, email)
    case, working_copy = _prepare(client)
    cookie = client.cookies.get("studio_session")

    with _server(on.app) as base:

        async def scenario():
            async with _client(base, working_copy["id"], cookie) as first:
                async with _client(base, working_copy["id"], cookie) as second:
                    first.insert(0, "同步内容")
                    await _wait(lambda: "同步内容" in str(second))
            async with _client(base, working_copy["id"], cookie) as reconnected:
                await _wait(lambda: "同步内容" in str(reconnected))

        asyncio.run(scenario())

        blocked = client.post(
            f"/api/v1/working-copies/{working_copy['id']}/commit",
            headers={"Idempotency-Key": "yjs-commit-before-flush"},
            json={"expected_version": 1},
        )
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["kind"] == "submission_barrier"
        flushed = client.post(f"/api/v1/working-copies/{working_copy['id']}/collab/flush")
        assert flushed.status_code == 200
        committed = client.post(
            f"/api/v1/working-copies/{working_copy['id']}/commit",
            headers={"Idempotency-Key": "yjs-commit-after-flush"},
            json={"expected_version": 1},
        )
        assert committed.status_code == 200, committed.text

    engine = create_engine(database_url(get_settings().database_url))
    try:
        with Session(engine) as session:
            rows = list(session.scalars(select(CollabUpdate).order_by(CollabUpdate.seq)))
            assert [row.seq for row in rows] == list(range(1, len(rows) + 1))
            assert rows and all(row.flushed_at is not None for row in rows)
    finally:
        engine.dispose()
