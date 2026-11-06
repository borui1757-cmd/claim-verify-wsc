"""演示：Guardrails 管编排，我们管事实。

用法：
  py tools/guardrails_demo.py
"""
import sys
import os

# Guardrails 默认会往 OTLP 上报遥测（本机解析不了那个域名，刷一堆黄字）。
# 只读演示，关掉。
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("GUARDRAILS_NO_TELEMETRY", "1")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from guardrails import Guard
from guardrails_bridge import ClaimVerify

# 0.11.x 的 API：on_fail 在**实例化 validator** 时传，不是给 use()
guard = Guard().use(ClaimVerify(on_fail="fix"))

samples = [
    "先算一下 12 × 12 = 143，然后收工。",
    "12 × 12 = 144，这个是对的。",
    "现在是 03:40，我们继续。",
]

for s in samples:
    try:
        out = guard.validate(s)
        print("输入:", s)
        print("  通过:", getattr(out, "validation_passed", None))
        print("  输出:", repr(getattr(out, "validated_output", None)))
        if getattr(out, "validation_summaries", None):
            for sm in out.validation_summaries:
                print("  摘要:", getattr(sm, "message", sm))
    except Exception as e:
        print("输入:", s)
        print("  异常:", type(e).__name__, str(e)[:160])
    print()
