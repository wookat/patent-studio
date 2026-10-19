# -*- coding: utf-8 -*-
"""Z24 冻结交付：sealed Release 构建产物确定性（无需 DB 的纯函数部分）。"""


def test_release_docx_zip_timestamps_normalized():
    """Z24：同一 sealed 内容重复构建必须逐字节一致——python-docx 按当前时间写 ZIP
    条目时间戳（2s 粒度），归一化后 sha256 稳定，幂等重建不被误判冲突。"""
    import io
    import time
    import zipfile

    from docx import Document

    from patent_studio.domain.releases import _normalize_zip_timestamps

    def _docx_bytes():
        buf = io.BytesIO()
        Document().save(buf)
        return buf.getvalue()

    a, b = _docx_bytes(), None
    time.sleep(2.2)  # 跨过 ZIP 时间戳 2 秒粒度
    b = _docx_bytes()
    assert a != b  # 原始产物确实带不同时间戳
    na, nb = _normalize_zip_timestamps(a), _normalize_zip_timestamps(b)
    assert na == nb
    assert zipfile.ZipFile(io.BytesIO(na)).namelist() == zipfile.ZipFile(io.BytesIO(b)).namelist()
