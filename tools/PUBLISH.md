# 发布步骤（只剩登录这一步需要你）

> 本机实测：`github.com` 超时、`api.github.com` 通、`gitee.com` 180ms、`registry.npmjs.org` 通。
> 所以先发 Gitee，GitHub 等网络能到网页时再镜像。

---

## 一、发到 Gitee（推荐，不需要 git）

**第 1 步：生成私人令牌**

打开 **https://gitee.com/profile/personal_access_tokens**

> 注意是 `/profile/` 下面那个地址。写成 `gitee.com/personal_access_tokens` 会被丢到登录页
> （没有 `redirect_to_url` 回跳参数，说明路径不存在）。

- 点 **「生成新令牌」**
- 描述：`claim-verify-wsc-publish`
- 权限：勾 **`projects`**（仓库读写）
- 有效期：7 天足够
- 提交后**只显示一次**，复制保存

**第 2 步：交给脚本**（在自己的 PowerShell 里执行，别贴进聊天）

```powershell
[Environment]::SetEnvironmentVariable('GITEE_TOKEN','粘贴你的令牌','User')
```

**第 3 步：发布**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File tools/publish-gitee.ps1 -Owner <你的Gitee用户名>
```

先看会传什么（不发送任何请求）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/publish-gitee.ps1 -DryRun
```

当前清单：**24 个文件 / 约 118 KB**（`eval/corpus.jsonl` 含真实会话片段，已排除）。

---

## 二、发到 GitHub（现在网络到不了，留着以后）

`github.com` 打不开 → 创不了 PAT。等网络能到网页时：

```powershell
$env:GITHUB_TOKEN = 'ghp_xxxxxxxx'
powershell -NoProfile -ExecutionPolicy Bypass -File tools/publish-github.ps1 -Owner <用户名>
```

脚本走 REST API（`api.github.com` 是通的），不依赖 git。

Gitee 也支持「从 GitHub 导入」，反过来手动镜像一次也行。

---

## 三、发到 npm

```powershell
npm login                      # 浏览器授权，只能你自己点
npm publish --tag experimental # 实验版，不要顶掉 latest
```

> `--tag experimental` 很关键：`npm i claim-verify-wsc` 装不到实验版，
> 只有显式 `npm i claim-verify-wsc@experimental` 才装。
> 数据攒够后 `npm dist-tag add claim-verify-wsc@<version> latest` 转正。

---

## 四、发布前最后一次自检

```bash
node test/dry.mjs && node test/policy.mjs && node test/hook.mjs
node eval/gold.mjs        # 退出码 0 = 没有误报
npm pack --dry-run        # 确认包里没有多余文件
```
