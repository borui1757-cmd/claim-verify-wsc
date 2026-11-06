"""
guardrails-bridge.py —— 让 Guardrails 框架调用我们的核验能力

分工：
  Guardrails 管结构（FIX / REFRAIN / REASK / 流式）
  我们管事实（/verify_text：把句子抽成断言，去问系统真值）

两种用法：
  A. 独立用（不需要装 guardrails-ai）：
       py tools/guardrails-bridge.py "现在是 03:40，12×12=143。"
  B. 作为 Validator 挂进 Guardrails Guard：
       from guardrails_bridge import ClaimVerify
       Guard().use(ClaimVerify, on_fail="fix")
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = os.environ.get("CLAIM_VERIFY_API", "http://127.0.0.1:8600").rstrip("/")
TIMEOUT = float(os.environ.get("CLAIM_VERIFY_TIMEOUT", "10"))


def verify_text(text):
    """调我们的 /verify_text，返回 {ok, count, results:[{claim, raw, ok, verdict, expect}]}"""
    body = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        API + "/verify_text",
        data=body,
        headers={"content-type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def split_sentences(text):
    parts = re.split(r"(?<=[。！？\n])", text)
    return [p for p in parts if p.strip()]


def drop_bad_sentences(text, bad_raws):
    """把包含错误断言的句子整句删掉（Guardrails 的 FIX 语义）"""
    keep = []
    for s in split_sentences(text):
        if any(raw and raw in s for raw in bad_raws):
            continue
        keep.append(s)
    out = "".join(keep).strip()
    return out


def check(text):
    j = verify_text(text)
    bad = [r for r in j.get("results", []) if not r.get("ok")]
    return j, bad


def main_cli():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out_path = None
    for a in sys.argv[1:]:
        if a.startswith("--out="):
            out_path = a.split("=", 1)[1]
    text = args[0] if args else sys.stdin.read()
    try:
        j, bad = check(text)
    except urllib.error.URLError as e:
        payload = {"ok": False, "error": "API 不可达：" + str(e)}
        print(json.dumps(payload, ensure_ascii=False))
        return 2
    fixed = drop_bad_sentences(text, [b.get("raw") for b in bad]) if bad else text
    out = {
        "ok": j.get("ok", False),
        "checked": j.get("count", 0),
        "bad": [{"raw": b.get("raw"), "verdict": b.get("verdict"), "expect": b.get("expect")} for b in bad],
        "fixed_text": fixed if bad else None,
    }
    text_out = json.dumps(out, ensure_ascii=False, indent=2)
    if out_path:
        # 自己写文件，避免 PowerShell 重定向写成 UTF-16
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text_out)
        print("written: " + out_path)
    else:
        sys.stdout.buffer.write(text_out.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
    return 0 if not bad else 1


# ── B：Guardrails Validator（可选）──────────────────────────────
try:
    from guardrails.validators import (  # type: ignore
        FailResult,
        PassResult,
        Validator,
    )

    class ClaimVerify(Validator):
        """把断言拿去核验；失败时提供 fix_value=删掉错误句子后的文本。"""

        def validate(self, value, metadata=None):
            try:
                j, bad = check(value)
            except Exception as e:  # API 不可达时放行，不误杀
                return PassResult(value_override=value, metadata={"claim_verify": "unreachable: " + str(e)})
            if not bad:
                return PassResult(value_override=value, metadata={"claim_verify": {"checked": j.get("count", 0)}})
            fixed = drop_bad_sentences(value, [b.get("raw") for b in bad])
            return FailResult(
                error_message="claim-verify 核验不通过：" + "; ".join(
                    f"{b.get('raw')} -> {b.get('expect') or b.get('verdict')}" for b in bad
                ),
                fix_value=fixed,
                metadata={"claim_verify": {"checked": j.get("count", 0), "bad": len(bad)}},
            )
except Exception:  # 没装 guardrails-ai 时只提供 CLI
    ClaimVerify = None


if __name__ == "__main__":
    sys.exit(main_cli())
