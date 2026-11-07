# 发布前清单（GitHub / 投稿用）

> 生成时间：2026-11-06
> 结论：**已打包，可发布**。压缩包在桌面：`claim-verify-public.zip`（101 个文件，389 KB）

## 一、发布范围

| 目录/文件 | 是否发布 | 原因 |
|---|---|---|
| `lib/` | ✅ | 核心实现 |
| `test/` | ✅ | 39 个断言式测试（不依赖本地数据） |
| `bin/` | ✅ | CLI 与校验命令 |
| `README.md` `CHANGELOG.md` `LICENSE` `package.json` `cordis.patch.yml` | ✅ | 包元信息 |
| `.github/` `.gitignore` | ✅ | 仓库配置 |
| `data/` | ❌ | 真实会话语料（含本机路径） |
| `docs/` | ❌ | 论文与内部记录（含真实案例） |
| `eval/` | ❌ | 研究脚本，硬编码本机路径；需要时另行脱敏发布 |
| `tools/` | ❌ | 临时脚本 |
| `bin/{autolabel,eval-dsl,harvest,label-audit,make-label-tool,replay-batch}.mjs` | ❌ | 已移到 `../_dev-bin/`（开发用，含本机路径） |

## 二、脱敏已完成的动作

1. 全仓扫描 `19156` / `sk-*` / `Bearer <token>` → **0 命中**
2. `test/` 与 `eval/` 内的真实用户名路径 → 统一替换为 `user`
3. `lib/index.js` 注释里的真实路径 → 改为 `~/.dsh`
4. 顶层误生成的垃圾文件已删除
5. `.gitignore` 覆盖 `data/ docs/ eval/ tools/` 与密钥/回执文件

## 三、验证记录

| 检查 | 结果 |
|---|---|
| `npm test`（39 个文件） | **全绿，0 FAIL** |
| 发布集敏感串扫描 | **0 命中** |
| 发布集文件数 | 101 |
| 打包 | 成功（389 KB） |

## 四、你还需要做的（机器上没装 git）

本机 **git 未安装**，所以无法帮你 `git init` / `push`。两条路：

**A. 装 git 后本地推**
```powershell
# 安装 git（或用 winget）
winget install --id Git.Git -e
# 解压 claim-verify-public.zip 到新目录，然后：
cd <解压目录>
git init
git add .
git commit -m "claim-verify-wsc: verify agent completion claims against OS truth"
git remote add origin <你的仓库地址>
git push -u origin main
```

**B. 用网页上传**
GitHub 新建仓库 → 上传解压后的文件夹（网页支持拖拽整个目录）。

## 五、发布后补两件（投稿需要）

| # | 事项 | 说明 |
|---|---|---|
| 1 | README 加截图/GIF | 演示轨评审会看 |
| 2 | 仓库描述与 topics | 建议：`agent` `verification` `hallucination` `os` `receipts` |

## 六、注意

- 仓库一旦公开，**`docs/` 里的论文草稿与真实案例绝不能放进去**
- 若后续想发布 `eval/`，需先把硬编码路径改成相对路径（约 20 个文件）
