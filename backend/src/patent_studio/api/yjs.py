"""PostgreSQL-backed Yjs transport.

The wire protocol is delegated to pycrdt's mature YRoom implementation.  This
adapter owns authentication, room scope and durable update-log/checkpoint writes.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass

from fastapi import APIRouter
from pycrdt import Doc, Text, YMessageType, YSyncMessageType
from pycrdt.websocket import YRoom, exception_logger
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool
from starlette.websockets import WebSocket, WebSocketDisconnect

from patent_studio.domain.collab import (
    CollabRoom,
    CollabUpdate,
    CollabUpdateInput,
    append_collab_updates,
    checkpoint_collab_room,
    create_collab_room,
    flush_collab_updates,
    get_collab_room,
)
from patent_studio.domain.documents import get_working_copy
from patent_studio.domain.identity import Principal
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import ObjectRef, object_ref, open_store
from patent_studio.settings import get_settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")
REJECT = 1008
_WRITE_MESSAGES = (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE)
_ROOMS: dict[uuid.UUID, PGRoom] = {}
_PAYLOADS: dict[str, bytes] = {}
_ROOM_LOCK = asyncio.Lock()


def _engine():
    url = get_settings().database_url
    if not url:
        raise RuntimeError("PostgreSQL is not configured")
    return create_engine(database_url(url), poolclass=NullPool, hide_parameters=True)


@contextmanager
def _db():
    engine = _engine()
    try:
        yield engine
    finally:
        engine.dispose()


async def _read_payload(ref: ObjectRef) -> bytes | None:
    cached = _PAYLOADS.get(ref.sha256)
    if cached is not None:
        return cached
    settings = get_settings()
    if not settings.storage_url:
        return None
    try:
        return await open_store(
            settings.storage_url,
            s3_endpoint_url=settings.s3_endpoint_url,
            s3_region=settings.s3_region,
        ).get(ref.key)
    except Exception:  # object-store outages do not leak details over the socket
        return None


async def _write_payload(data: bytes) -> ObjectRef:
    settings = get_settings()
    ref = object_ref(data, "application/octet-stream")
    _PAYLOADS[ref.sha256] = data
    if settings.storage_url:
        return await open_store(
            settings.storage_url,
            s3_endpoint_url=settings.s3_endpoint_url,
            s3_region=settings.s3_region,
        ).put(data, ref.content_type)
    return ref


def _principal_room(working_copy_id: uuid.UUID, user_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    with _db() as engine, Session(engine) as session, session.begin():
        principal = session.scalar(select(Principal).where(Principal.user_id == user_id))
        if principal is None:
            raise PermissionError("principal is not provisioned")
        working_copy = get_working_copy(session, working_copy_id, principal_id=principal.id)
        room = session.scalar(select(CollabRoom).where(CollabRoom.working_copy_id == working_copy.id))
        if room is None:
            room = create_collab_room(session, working_copy.id, principal_id=principal.id)
        return room.id, principal.id


async def _restore(room_id: uuid.UUID, principal_id: uuid.UUID) -> Doc:
    ydoc = Doc()
    with _db() as engine, Session(engine) as session:
        room = get_collab_room(session, room_id, principal_id=principal_id)
        rows = list(session.scalars(
            select(CollabUpdate).where(CollabUpdate.room_id == room.id).order_by(CollabUpdate.seq)
        ))
        refs = [room.checkpoint_ref] if room.checkpoint_ref is not None else []
        refs.extend(row.content_ref for row in rows if row.seq > room.checkpoint_seq)
    for ref in refs:
        data = await _read_payload(ref)
        if data:
            try:
                ydoc.apply_update(data)
            except Exception:
                log.warning("discarding unreadable Yjs state", exc_info=True)
    if ydoc.get("content", type=Text) is None:
        ydoc["content"] = Text()
    return ydoc


@dataclass
class PGRoom:
    room_id: uuid.UUID
    principal_id: uuid.UUID
    ydoc: Doc

    def __post_init__(self):
        self.loop = asyncio.get_running_loop()
        self.yroom = YRoom(ydoc=self.ydoc, ready=True, exception_handler=exception_logger, log=log)
        self.queue: asyncio.Queue[tuple[uuid.UUID, bytes, int]] = asyncio.Queue()
        self.last_state = self.ydoc.get_state()
        self.last_actor = self.principal_id
        self._capture_scheduled = False
        self.worker = asyncio.create_task(self._persist_loop())
        self.task = asyncio.create_task(self.yroom.start())
        self.text = self.ydoc.get("content", type=Text)
        self.subscription = self.text.observe(self._changed)

    def _changed(self, event):
        if event.transaction.origin == "server":
            return
        if not self._capture_scheduled:
            self._capture_scheduled = True
            self.loop.call_soon(self._capture_update)

    def _capture_update(self):
        self._capture_scheduled = False
        update = self.ydoc.get_update(self.last_state)
        self.last_state = self.ydoc.get_state()
        log.debug("Yjs room update captured: %d bytes", len(update))
        if update and update != b"\x00\x00":
            self.queue.put_nowait((self.last_actor, update, int(time.time())))

    async def _persist_loop(self):
        while True:
            actor, data, clock = await self.queue.get()
            try:
                ref = await _write_payload(data)
                with _db() as engine, Session(engine) as session, session.begin():
                    append_collab_updates(
                        session,
                        self.room_id,
                        principal_id=actor,
                        updates=[CollabUpdateInput(clock=clock, content_ref=ref)],
                    )
            except Exception:
                log.warning("Yjs update persistence failed", exc_info=True)
            finally:
                self.queue.task_done()

    async def stop(self):
        await self.queue.join()
        self.subscription.drop()
        self.worker.cancel()
        await self.yroom.stop()
        self.task.cancel()


async def _room(room_id: uuid.UUID, principal_id: uuid.UUID) -> PGRoom:
    async with _ROOM_LOCK:
        existing = _ROOMS.get(room_id)
        if existing is not None:
            existing.last_actor = principal_id
            return existing
        ydoc = await _restore(room_id, principal_id)
        created = PGRoom(room_id, principal_id, ydoc)
        _ROOMS[room_id] = created
        await created.yroom.ydoc_observed.wait()
        return created


class Channel:
    def __init__(self, websocket: WebSocket, room: PGRoom, principal_id: uuid.UUID):
        self.websocket = websocket
        self.room = room
        self.principal_id = principal_id
        self.path = f"working-copy/{room.room_id}"

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            message = await self.websocket.receive_bytes()
        except (WebSocketDisconnect, RuntimeError):
            raise StopAsyncIteration()
        if message and message[0] == YMessageType.SYNC and len(message) > 1 and message[1] in _WRITE_MESSAGES:
            self.room.last_actor = self.principal_id
        return message

    async def send(self, message: bytes):
        try:
            await self.websocket.send_bytes(message)
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass


async def _identify(websocket: WebSocket, working_copy_id: uuid.UUID):
    from patent_studio.infra.auth import auth_on, read_cookie_user

    user = await read_cookie_user(websocket) if auth_on() else None
    if user is None:
        return None
    try:
        return await asyncio.to_thread(_principal_room, working_copy_id, user.id)
    except Exception as exc:
        log.debug("Yjs room authorization failed: %s", type(exc).__name__)
        return None


async def collab_ws(websocket: WebSocket):
    await websocket.accept()
    try:
        working_copy_id = uuid.UUID(websocket.path_params["working_copy_id"])
    except ValueError:
        await websocket.close(code=REJECT, reason="bad_working_copy")
        return
    identity = await _identify(websocket, working_copy_id)
    if identity is None:
        await websocket.close(code=REJECT, reason="forbidden")
        return
    room_id, principal_id = identity
    room = await _room(room_id, principal_id)
    try:
        await room.yroom.serve(Channel(websocket, room, principal_id))
    finally:
        if not room.yroom.clients:
            await room.stop()
            _ROOMS.pop(room_id, None)


async def flush_room(working_copy_id: uuid.UUID, principal_id: uuid.UUID) -> int:
    with _db() as engine, Session(engine) as session:
        room = session.scalar(select(CollabRoom).where(CollabRoom.working_copy_id == working_copy_id))
        if room is None:
            raise ValueError("collaboration room does not exist")
        room_id = room.id
    active = _ROOMS.get(room_id)
    if active is not None:
        await active.queue.join()
        checkpoint = await _write_payload(active.ydoc.get_update())
    else:
        checkpoint = None
    with _db() as engine, Session(engine) as session, session.begin():
        room = get_collab_room(session, room_id, principal_id=principal_id)
        count = flush_collab_updates(session, room.id, principal_id=principal_id)
        if checkpoint is not None:
            checkpoint_collab_room(
                session,
                room.id,
                principal_id=principal_id,
                checkpoint_seq=room.last_seq,
                checkpoint_ref=checkpoint,
            )
        return count


router.add_websocket_route(
    "/working-copies/{working_copy_id}/collab", collab_ws, name="platform_collab_ws"
)
