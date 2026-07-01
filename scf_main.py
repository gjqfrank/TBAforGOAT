"""腾讯云 SCF (Serverless Cloud Function) 适配入口。

FastAPI 是 ASGI 应用，SCF 需要 WSGI 兼容的入口。
使用 mangum 桥接 ASGI → WSGI。

部署步骤：
1. 在腾讯云 SCF 控制台创建函数
2. 运行环境：Python 3.9+
3. 入口函数：scf_main.main_handler
4. 设置环境变量 TBA_API_KEY
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mangum import Mangum
from backend.app.main import app

# 禁用后台 worker（SCF 是无状态的，不支持后台任务）
os.environ["DISABLE_WORKERS"] = "true"

handler = Mangum(app, lifespan="off")


def main_handler(event, context):
    """SCF 入口函数。"""
    return handler(event, context)
