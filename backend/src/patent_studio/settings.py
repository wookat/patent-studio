# -*- coding: utf-8 -*-
"""平台运行配置：统一读 PATENT_STUDIO_* 环境变量。"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PATENT_STUDIO_", extra="ignore")

    # PostgreSQL，如 postgresql://user:pass@host:5432/patent_studio（驱动固定为 psycopg）
    database_url: str | None = None
    # 对象存储：file:///abs/dir 或 s3://bucket[/prefix]；S3 凭证走标准 AWS_* 环境变量
    storage_url: str | None = None
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    # LLM 网关（OpenAI 兼容）：三者齐全才启用真实模型，否则保持 stub
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None
    # Run 事件 SSE：库轮询间隔 / 心跳注释帧间隔 / 单连接最长时间（秒）
    sse_poll_seconds: float = 0.5
    sse_heartbeat_seconds: float = 15.0
    sse_max_seconds: float = 300.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
