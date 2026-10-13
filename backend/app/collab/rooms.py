# -*- coding: utf-8 -*-
"""房间 = (pid, book)，文档 = 一个 Y.Text（11 §2/§3.2）。

- book ∈ BOOKS：三书对应 content.md 现场 split 出的该书正文（与 GET /docs/{book} 同源，不读 docs/ 镜像）；
  `content` 对应装配镜像 content.md（现有单编辑器打开的文件）。
- 首个连接：读磁盘文本 → `Text` 初始化；服务端权威，客户端不做本地持久化。
- 写回：Y 文档变更后去抖 DEBOUNCE_S → 三书用 `docset.replace` 装配、content 直接
  → `history.override("collab:{book}", author)` + `store.save_content(pid, md, backup=False)`（在线程里跑，
  git 是子进程）；与磁盘相同则不写、不 commit。
- 外部改写：`ProjectStore.save_content` 末尾调用 `on_saved(pid, content)`，各活跃房间用 `text.apply_full_text` 做
  服务端替换全文（同一事务、origin="server"）并广播；房间记着本书最近一次落盘文本 `disk`，on_saved 带来的本书
  文本与之相同（自身写回的回声、或别的书被改）⇒ 无操作，不碰未到去抖点的键入。
- 只读连接（AUTH=on 且角色 viewer）：Channel 丢弃入站 SYNC_STEP2 / SYNC_UPDATE，只回 step1 / 转发广播。
- 释放：最后一个客户端断开后 IDLE_RELEASE_S 无人再进 ⇒ 先落盘（若有未写回变更）再停房间；pycrdt-websocket 的
  `auto_clean_rooms` 是"立即删"，不能直接用。
- Y 文档身份持久化：`.studio/collab/<book>.ybin` 存 `ydoc.get_update()`（落盘 / 外部改写 / 停房间时写）。房间重建
  （进程重启、闲置释放后再进）先 `apply_update` 恢复同一 Y 文档，再 `apply_full_text` 对齐磁盘正文；否则仍持有旧
  Y.Doc 的浏览器重连时，两份独立插入的同一段文本会被 CRDT 合并成双份（296 → 632 行的事故）。
"""
import asyncio
import logging
import os

from pycrdt import Doc, Text, YMessageType, YSyncMessageType, create_awareness_message
from pycrdt.websocket import YRoom, exception_logger
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.collab.text import apply_full_text
from app.domain import history, review_meta
from patent_studio.kernel import docset

BOOKS = ("abstract", "claims", "description", "content")
DEBOUNCE_S = 0.8
IDLE_RELEASE_S = 60.0
YTEXT_KEY = "content"
STATE_DIR = "collab"
SERVER = "server"
DEFAULT_AUTHOR = "collab"

log = logging.getLogger(__name__)
_WRITE_MSGS = (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE)

# 与 events._pending / notify._tasks 同惯例：fire-and-forget 任务持强引用防 GC 半途回收
_pending: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    task = asyncio.ensure_future(coro)
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def _book_text(content, book):
    return content if book == "content" else docset.split(content).book(book)


def state_path(store, pid, book):
    return os.path.join(store.get(pid).studio_dir, STATE_DIR, f"{book}.ybin")


def _load_state(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None


def _restore_doc(state, initial):
    """用持久化状态重建 Y 文档并把正文对齐到磁盘；状态损坏则退回全新文档。"""
    ydoc = Doc()
    if state:
        try:
            ydoc.apply_update(state)
            text = ydoc.get(YTEXT_KEY, type=Text)
            apply_full_text(text, initial, origin=SERVER)
            return ydoc, text
        except Exception:  # noqa: BLE001 — 状态文件不可用时不能拖垮房间
            log.warning("collab state unreadable, starting a fresh doc", exc_info=True)
            ydoc = Doc()
    ydoc[YTEXT_KEY] = text = Text(initial)
    return ydoc, text


class Room:
    def __init__(self, pid, book, store, initial, state=None, state_file=None):
        self.pid, self.book, self.store = pid, book, store
        self.loop = asyncio.get_running_loop()
        self.state_file = state_file
        self.ydoc, self.text = _restore_doc(state, initial)
        self.yroom = YRoom(ydoc=self.ydoc, ready=True, exception_handler=exception_logger, log=log)
        self.task = None
        self.writeback = None
        self.release = None
        self.last_author = DEFAULT_AUTHOR
        self.dirty = False
        self.disk = initial
        self._lock = asyncio.Lock()
        self.text.observe(self._on_change)

    @property
    def peers(self):
        return len(self.yroom.clients)

    def start(self):
        self.task = asyncio.create_task(self.yroom.start())

    async def stop(self):
        if self.writeback is not None:
            self.writeback.cancel()
            self.writeback = None
        await self.flush()
        self.persist()
        await self.yroom.stop()
        self.task.cancel()

    def persist(self):
        """把 Y 文档完整状态写到 `state_file`（原子替换）。在事件循环线程调用：`get_update` 不能与文档事务
        并发；状态量级是正文大小，同步写一次在毫秒级。未配置路径（测试直建 Room）则跳过。"""
        if not self.state_file:
            return
        update = self.ydoc.get_update()
        os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
        tmp = f"{self.state_file}.tmp"
        with open(tmp, "wb") as f:
            f.write(update)
        os.replace(tmp, self.state_file)

    # --- 去抖写回 ---
    def _on_change(self, event):
        if event.transaction.origin == SERVER:
            return
        self.dirty = True
        if self.writeback is not None:
            self.writeback.cancel()
        self.writeback = self.loop.call_later(DEBOUNCE_S, self._fire)

    def _fire(self):
        self.writeback = None
        _spawn(self.flush())

    async def flush(self):
        """把当前 Y.Text 落盘（与磁盘一致则不写不 commit）。"""
        async with self._lock:
            if not self.dirty:
                return
            self.dirty = False
            self.persist()
            await asyncio.to_thread(self._write, str(self.text), self.last_author)

    def _write(self, new, author):
        cur = self.store.read_content(self.pid)
        if self.book == "content":
            md = new
        else:
            md = docset.assemble(docset.replace(docset.split(cur), self.book, new))
        self.disk = _book_text(md, self.book)
        if md == cur:
            return
        meta_author = None if author == DEFAULT_AUTHOR else author
        with history.override(f"collab:{self.book}", author), review_meta.writer(meta_author):
            self.store.save_content(self.pid, md, backup=False)

    # --- 外部改写 → 广播 ---
    def apply_external(self, content):
        new = _book_text(content, self.book)
        if new == self.disk:
            return
        self.disk = new
        if self.writeback is not None:
            self.writeback.cancel()
            self.writeback = None
        self.dirty = False
        apply_full_text(self.text, new, origin=SERVER)
        self.persist()


class Channel:
    """pycrdt `Channel` 协议套在 Starlette WebSocket 上；记录写入者、只读端丢弃写消息。"""

    def __init__(self, ws: WebSocket, room: Room, author: str, readonly: bool, user_id: str | None = None):
        self.ws, self.room, self.author, self.readonly = ws, room, author, readonly
        self.user_id = user_id  # W4-B 在线来源（14 D4）：AUTH=on 时为 str(User.id)
        self.path = f"{room.pid}/{room.book}"

    def __aiter__(self):
        return self

    async def __anext__(self) -> bytes:
        while True:
            try:
                msg = await self.recv()
            except (WebSocketDisconnect, RuntimeError):
                raise StopAsyncIteration()
            if msg and msg[0] == YMessageType.SYNC and len(msg) > 1 and msg[1] in _WRITE_MSGS:
                if self.readonly:
                    continue
                self.room.last_author = self.author
            return msg

    async def send(self, message: bytes) -> None:
        try:
            await self.ws.send_bytes(message)
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass  # 对端已断开；房间的 finally 会移除该客户端

    async def recv(self) -> bytes:
        return bytes(await self.ws.receive_bytes())


ROOMS: dict[tuple[str, str], Room] = {}
PENDING: dict[tuple[str, str], asyncio.Future] = {}


async def get_or_create(pid, book, store) -> Room:
    key = (pid, book)
    room = ROOMS.get(key)
    if room is None:
        if key in PENDING:  # 并发首连：等同一次建房，不各读一遍磁盘
            room = await PENDING[key]
        else:
            fut = PENDING[key] = asyncio.get_running_loop().create_future()
            try:
                path = state_path(store, pid, book)
                initial, state = await asyncio.to_thread(
                    lambda: (_book_text(store.read_content(pid), book), _load_state(path))
                )
                room = ROOMS[key] = Room(pid, book, store, initial, state, path)
                room.start()
            except BaseException as e:
                fut.set_exception(e)
                raise
            else:
                fut.set_result(room)
            finally:
                del PENDING[key]
    await room.yroom.ydoc_observed.wait()
    if room.release is not None:
        room.release.cancel()
        room.release = None
    return room


async def serve(room: Room, channel: Channel) -> None:
    try:
        others = [cid for cid in room.yroom.awareness.states if cid != room.yroom.awareness.client_id]
        if others:
            await channel.send(create_awareness_message(room.yroom.awareness.encode_awareness_update(others)))
        await room.yroom.serve(channel)
    finally:
        if not room.yroom.clients and ROOMS.get((room.pid, room.book)) is room:
            room.release = room.loop.call_later(IDLE_RELEASE_S, lambda: _spawn(drop(room)))


async def drop(room: Room) -> None:
    if ROOMS.get((room.pid, room.book)) is not room:
        return
    del ROOMS[(room.pid, room.book)]
    await room.stop()


def rooms_of(pid):
    return [{"book": r.book, "peers": r.peers} for (p, _), r in ROOMS.items() if p == pid]


def online_user_ids(pid: str) -> set[str]:
    """本案任一房间里有活连接的用户 id（`YRoom.clients` 里的 Channel.user_id）；AUTH=off 下为空。"""
    return {ch.user_id for (p, _), r in ROOMS.items() if p == pid for ch in r.yroom.clients if ch.user_id}


def on_saved(pid: str, content: str) -> None:
    """`ProjectStore.save_content` 写盘后调用（同步，可能在线程池里）：把新全文投递给 pid 的活跃房间。"""
    for (p, _), room in list(ROOMS.items()):
        if p == pid:
            room.loop.call_soon_threadsafe(room.apply_external, content)


async def shutdown() -> None:
    """测试/进程退出：落盘并停掉全部房间。"""
    for room in list(ROOMS.values()):
        await drop(room)
