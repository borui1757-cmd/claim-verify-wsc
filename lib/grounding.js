// grounding.js —— 把「这一轮模型看到的工具输出」抽成证据文档。
//
// 为什么从这里取：llm/stream 的 options 里没有 agent/session，
// 但 messages 里有工具结果，形如 { role: 'tool', toolCallId, isError, content: [{type:'text',text}] }
// （见 dsh-session 的 tool/result 派生）。尾部连续的那一段就是本轮接地材料。

const DEFAULT_MAX = 6000;
const DEFAULT_PER_TOOL = 900;

function contentToText(content) {
  if (typeof content === 'string')
    return content;
  if (!Array.isArray(content))
    return content === null || content === undefined ? '' : JSON.stringify(content);
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object')
      continue;
    if (typeof part.text === 'string') {
      parts.push(part.text);
      continue;
    }
    // 非文本块（图片、资源引用）只留类型，避免把二进制塞进证据
    if (typeof part.type === 'string')
      parts.push(`[${part.type}]`);
  }
  return parts.join('\n');
}

/** 截断到 n 字符，保留头部与尾部（错误常在尾部）。 */
function clip(text, n) {
  if (text.length <= n)
    return text;
  const head = Math.floor(n * 0.7);
  const tail = n - head;
  return `${text.slice(0, head)}\n…（截断 ${text.length - n} 字）…\n${text.slice(-tail)}`;
}

/**
 * 从 messages 里抽出本轮工具输出。
 * @returns {{blocks:Array<{toolCallId:string|null,isError:boolean,chars:number,text:string}>, doc:string, chars:number, errors:number}}
 */
export function extractGrounding(messages, options = {}) {
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : DEFAULT_MAX;
  const perTool = Number(options.perToolMax) > 0 ? Number(options.perToolMax) : DEFAULT_PER_TOOL;
  const list = Array.isArray(messages) ? messages : [];

  const blocks = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!m || m.role !== 'tool')
      break; // 只取尾部连续的工具结果，碰到别的消息就停
    const text = contentToText(m.content);
    blocks.unshift({
      toolCallId: typeof m.toolCallId === 'string' ? m.toolCallId : null,
      isError: m.isError === true,
      chars: text.length,
      text: clip(text, perTool),
    });
  }

  let doc = blocks.map((b, i) => `[工具结果 ${i + 1}${b.isError ? ' · 报错' : ''}]\n${b.text}`).join('\n\n');
  if (doc.length > maxChars)
    doc = clip(doc, maxChars);

  return {
    blocks,
    doc,
    chars: doc.length,
    errors: blocks.filter((b) => b.isError).length,
  };
}
