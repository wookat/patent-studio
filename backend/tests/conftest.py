import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

# s8 先行技术检索：测试环境默认不给 provider，防用例真发外部请求；单测用 monkeypatch 按需打开
os.environ.setdefault("PATENT_STUDIO_PRIOR_ART_PROVIDERS", "")
