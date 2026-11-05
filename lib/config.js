// config.js —— 唯一依赖 DSH 生态（schemastery）的文件。
//
// 单独拆出来是有意为之：核心（core 部分）是纯 Node 零依赖，只有这个文件需要
// @deepseek-ai/schemastery 才能给 DSH 提供带默认值与校验的配置模式。
// 在 DSH 之外使用时，index.js 用动态 import 加载它；加载不到就把 Config 留空，
// 核心功能（verifyText / CLI）完全不受影响。

import Schema from '@deepseek-ai/schemastery';

export const Config = Schema.object({
  enable: Schema.boolean().default(true),
  /** 追加核验说明；默认 false = observe 模式，只写日志不打扰对话。 */
  annotate: Schema.boolean().default(false),
  /** 单次核验的总预算，超时就放弃（绝不拖住对话）。 */
  budgetMs: Schema.number().default(1500),
  /** 端口探活超时。 */
  portTimeoutMs: Schema.number().default(300),
  /** 金额相对容差（0.3 = 30%）。 */
  moneyTolerance: Schema.number().default(0.3),
  /** 可选：数 html 页面的目录（不配就跳过计数类断言）。 */
  pagesDir: Schema.string().default(''),
  /** 可选：数按钮的 html 文件（不配就跳过）。 */
  buttonsFile: Schema.string().default(''),
  /** 级联触发：核验失败后，下一次请求自动升级到指定模型。默认关闭。 */
  cascadeEnabled: Schema.boolean().default(false),
  cascadeProvider: Schema.string().default(''),
  cascadeModel: Schema.string().default(''),
  /** 单个会话最多升级几次（防止无限降级/循环）。 */
  cascadeMax: Schema.number().default(2),
  /** 结构化对账（promise/evidence，零模型调用）。默认开；与 sentenceAudit 解耦。 */
  structuralAudit: Schema.boolean().default(true),
  /** v0.3 第 2 层：句子级三分类核验（写入 audit.jsonl，不改输出）。默认关闭。 */
  sentenceAudit: Schema.boolean().default(false),
  sentenceAuditMax: Schema.number().default(12),
  /** 只在「本轮有工具失败」时才核验——省掉 5 秒/轮的成本。默认开。 */
  sentenceAuditOnlyOnFailure: Schema.boolean().default(true),
  /** 断言编译器（自然语言 → 只读 DSL 检查 → 程序执行）。默认关，打开会增加模型调用。 */
  dslAudit: Schema.boolean().default(false),
  dslAuditMax: Schema.number().default(3),
  /** 执行前授权：默认放行；dslPolicyDeny 里列出的原语一律拒绝（逗号分隔）。 */
  dslPolicyDefault: Schema.string().default('allow'),
  dslPolicyDeny: Schema.string().default(''),
  /** 判为「待人工批准」的原语（逗号分隔）；pending 的计划不执行，等 bin/approve.mjs。 */
  dslPolicyPending: Schema.string().default(''),
  /** 写文件的范围限制：只有这个绝对路径前缀下的写才允许进入审批，其它一律 deny。空 = 不限制。 */
  dslPolicyWritePrefix: Schema.string().default(''),
  /** 报告隔离审计（声明只看报告、证据只看轨迹、判定不看模型）。默认关；打开后替代原 LLM 句子审计。 */
  isolatedAudit: Schema.boolean().default(false),
  /** 回写：把核验结论送回模型。off=关；failure=工具失败即刻回写；audit=轮末审计发现矛盾后回写；both=两者 */
  feedbackMode: Schema.union(['off', 'failure', 'audit', 'both']).default('failure'),
  /** 回写强度：soft 只陈述事实；firm 要求先修正；block 未通过不得宣称完成 */
  feedbackLevel: Schema.union(['soft', 'firm', 'block']).default('firm'),
  /** 每轮最多攒几条回写（防止刷屏） */
  feedbackMaxPerTurn: Schema.number().min(0).max(5).default(2),
  /** 同一目标最多回写几次；超过则改为"升级"提示（防空转） */
  feedbackMaxPerTarget: Schema.number().min(0).max(10).default(2),
  /** 每轮回写预算总量（含升级提示） */
  feedbackBudget: Schema.number().min(0).max(10).default(3),
  /** 先做结构对账（不调模型）；命中就不再调模型。默认开。 */
  structuralFirst: Schema.boolean().default(true),
  /** 三票制：结构层判 contradicted 时，要求模型也给同判才保留（≥2 票）。默认开。 */
  voteOnContradicted: Schema.boolean().default(true),
  /** 证据窗口：报告常总结上一轮，默认覆盖最近 2 轮。 */
  auditTurnWindow: Schema.number().default(2),
  /** 调试日志（debug.jsonl）。默认关：它每次审计都写，一天能长到十几 MB。 */
  debug: Schema.boolean().default(false),
  /** 结构化声明回执：模型输出带 ```claims 块时，生成带签名的证据回执。默认开。 */
  receipts: Schema.boolean().default(true),
  logFile: Schema.string().default(''),
});

export default Config;
