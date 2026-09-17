# Feishu ↔ Grok Bot Bridge — 项目 Todo

> 维护说明：本文件是当前迭代的功能与规划细节清单。完成后勾选；范围变更请同步改本文件与 Notion 评估页。

- 仓库：https://github.com/WilliamLX/feishu-grok-bridge
- Notion PRD：https://app.notion.com/p/3db5e183fd02818d8e85c044d83628c5
- Notion M2 评估：https://app.notion.com/p/3dc5e183fd0281d39abae42b5a9031cc
- 更新日：2026-09-15（下一步锁定：§11 Ops）

---

## 0. 总览

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| V1（HttpBackend + mention/ACL + 处理中提示） | ✅ 已正式收口 | main `fbf68e6`；PR #1/#3/#2 已合；飞书联调 + 审核通过 |
| **M2a（单聊选 Bot）** | ✅ 正式结案 | PR #5 闭环；联调 + 审核收口完成 |
| **运维清单（Ops）** | 🟡 **下一步（进行中）** | 方法/架构见 §11；补全并验证后才开 M2b |
| M2b（多选组群 + @ 路由） | ⬜ 后置 | Bridge 约 4–6.5 / 产品 5–8；建群权限提前单独开 |

**当前目标**：先完成 **运维清单（Ops）**，再开 M2b。CursorAgent 真接通、钉钉实现仍后置。

---

## 1. V1 已完成（归档）

- [x] PRD 定稿与 V1 决策锁定（HttpBackend、一 chat 一 Agent、个人白名单、钉钉只对齐契约）
- [x] PR #1 合并（mention / 相关准入）
- [x] PR #3 合并（mention `open_id` 归一、群禁 bootstrap `/whoami`、ACL 文案、HTTP 超时）
- [x] PR #2 合并（Bridge 入站立刻「收到，正在处理中」+ 同 chat 串行不抢答）
- [x] 拉 main、重启 bridge + `:8787` 中继；本地 63 tests 过
- [x] 飞书单聊联调：ack→最终；连发顺序正确
- [x] 开发审核工程师正式收口

---

## 2. M2a 目标（本轮要交付什么）

**一句话**：用户在飞书单聊里能从多个 Grok Bot/Agent 中选出一个，绑定到当前 chat；之后消息按该 `agentId` 走中继；切换 Bot 会清会话且不抢答。

### 2.1 用户故事

1. 我打开与机器人的单聊，能看到可用 Bot 列表（卡片或 `/bots`）。
2. 我选中一个 Bot 后，当前 chat 绑定到该 Agent；之后对话都打到它。
3. 我切换到另一个 Bot 时，旧会话清空，旧 Agent 队列不再出队抢答。
4. 若 Bot/agentId 无效或未知，系统明确报错，**绝不静默落到默认 Bot**。
5. Bridge 重启后，chat→agent 绑定仍然在。
6. V1 行为不回退：mention/ACL、处理中 ack、同 chat 连发顺序仍正确。

### 2.2 明确不做（M2a）

- 多选多个 Bot 建群 / 群内多 Bot @ 路由 → **M2b**
- CursorAgentBackend 真接通 → **另排**
- 钉钉通道实现 → **后置**
- 管理后台可视化 → **后置**
- 富媒体入站 → **后置**

---

## 3. M2a 功能点明细

### A. Bot 目录与发现

- [x] 可配置 Bot/Agent 列表：至少含 `id`、显示名、描述（可选：是否启用）
- [x] 飞书可查看列表：`/bots` 和/或交互卡片
- [x] 列表结果仍受 `ALLOW_FROM` 等 ACL 约束（无权限用户看不到/选不了）
- [x] 配置来源文档化（env / JSON / 文件路径 — 实现时选定并写进 README）

### B. 单聊选择与绑定

- [x] 用户选择一个 Bot → 写入 `chat_id → agent_id` 绑定
- [x] 选定后该 chat 固定走该 agent，直到显式重选
- [x] `/status`（或等价）展示当前绑定的 Bot/agentId
- [x] 产品约定：`/new` **清历史、不清绑定**（若实现偏离须改本文件并同步 Notion）
- [x] 切换 Bot：**必须清会话**；旧 agent **不得**再出队抢答

### C. 中继 / HttpBackend 动态 agentId

- [x] 去掉（或停用）写死 `agentId`
- [x] 按 `chatId` 查绑定表，再 `sendPrompt`（或等价）传入动态 `agentId`
- [x] 未知 / 失效 `agentId`：**直接报错回飞书**，禁止静默默认 Bot（验收硬门禁）
- [x] 失败可观测（日志脱敏、用户可读错误）

### D. 绑定持久化

- [x] `chat_id → agent_id` 持久化，进程重启不丢
- [x] 存储选型由研发定（文件 / SQLite / 其他），须满足重启不丢
- [x] 提供最小运维说明（文件位置 / 如何重置绑定）

### E. 交互载体

- [x] 优先：飞书交互卡片（按钮选 Bot）
- [x] 降级：命令 `/bots`、`/bot <id>`（或等价）
- [x] 卡片回调接入 Bridge；与一 chat 一 Agent、串行队列一致
- [x] 错误态文案：无权限、Bot 不存在、中继失败、未绑定就发消息时的引导

### F. 与 V1 行为对齐

- [x] 处理中提示仍为 **Bridge 入站立刻回**，不挂在 HttpBackend 等待路径
- [x] 同 chat 串行：切换前后都不乱序、不抢答
- [x] mention `open_id` 归一、ACL fail-closed 回归绿

---

## 4. M2a 实施规划（建议顺序）

### Phase 0 — 准备（0.5d 内）

- [x] 确认 Bot 目录初始名单（DingDing + SE001）
- [ ] 确认飞书交互卡片权限已开通（选 Bot；建群权限留给 M2b，本轮不赌）
- [x] 约定绑定存储方案与路径
- [x] 开 M2a 功能分支；与中继改动分支策略对齐（PR #5 含 bridge + 中继）

### Phase 1 — 绑定表 + 中继动态路由（约 1–1.5d）

- [x] Bridge：实现 `chat→agent` 读写 API/模块
- [x] 中继：按 chatId 查绑定再发送；坏 agentId fail-closed
- [x] 单测：绑定 CRUD、坏 id、重启加载（若可测）

### Phase 2 — Bot 目录 + 选择交互（约 1.5–2.5d 卡片 + 1–1.5d Bridge 对接）

- [x] Bot 目录配置与读取
- [x] `/bots`、`/bot <id>`（或等价命令）
- [x] 交互卡片选 Bot + 回调
- [x] 选择成功后写绑定；切换时清会话、停旧队列

### Phase 3 — 串行 / ack 对齐 + 回归（约 0.5–1.5d）

- [x] 确认处理中 ack 与串行队列按**当前绑定 agent**工作
- [x] V1 回归：mention / ACL / ack / 连发顺序
- [x] 切换 Bot 专项：清会话、旧队列不抢答、坏 id 报错

### Phase 4 — 联调与收口

- [x] 飞书单聊：列表 → 选 A 对话 → 切 B → 确认会话已清且打到 B
- [x] 故意选无效 id / 删绑定：应失败提示，不进默认 Bot（代码测试 + relay smoke）
- [x] 重启 bridge/中继后绑定仍在（FileBindingStore 测试 + 代码审）
- [x] 开发审核按 §5 验收表收口（正式结案）
- [x] 更新本文件勾选 + Notion 进度

---

## 5. M2a 验收表（硬门禁）

| # | 验收项 | 负责人 | 状态 |
| --- | --- | --- | --- |
| 1 | 切换 Bot 必须清会话，且旧 agent 不出队抢答 | 研发 + 审核 | ✅ 联调 |
| 2 | 未知/失效 agentId fail-closed，不能静默打到默认 | 中继必须做死 + 审核 | ✅ 代码审 + smoke |
| 3 | 绑定持久化，重启不丢 | 研发 + 审核 | ✅ 代码审 |
| 4 | V1 回归绿：mention / ACL / ack / 同 chat 连发顺序 | 研发 + 审核 | ✅ 86 tests + 联调 |

额外建议手测：

- [x] `/status` 显示当前 Bot（代码测试）
- [x] 无绑定时发消息有明确引导（去选 Bot）（代码测试）
- [x] 白名单外用户仍 fail-closed（代码测试）

---

## 6. 工作量（已锁定）

| 模块 | 人日 |
| --- | --- |
| 中继动态 agentId + 绑定查询 | 0.5–1（口径并入绑定+中继时 1–1.5） |
| 选 Bot 卡片/命令 | 1.5–2.5 |
| Bridge 绑定持久化 + 切换清会话 | 1–1.5 |
| Bridge Bot 目录 + 回调对接 | 1–1.5 |
| 串行/ack 按绑定 agent | 0.5 |
| V1 回归 | 0.5–1 |
| **M2a 端到端** | **5–6 + 0.5 buffer** |
| M2b（后置，不排进本轮） | Bridge 4–6.5 / 产品 5–8 |

---

## 7. 角色与协作

| 角色 | M2a 职责 |
| --- | --- |
| 产品经理 | 范围锁定、验收口径、维护本 `todo.md` 与 Notion |
| Software Engineer 001 | Bridge/会话/绑定/回归；提 PR |
| DingDing to Grok Bot | 中继动态 agentId、卡片/联调环境、本地 bridge/中继 |
| 开发审核工程师 | 按 §5 四条 + V1 回归审核；多 Bot 组群改动若混入 M2a PR 打回 |

---


---

## 11. 下一步：运维清单落地（Ops）

> **范围锁定（2026-09-15）**：下一步只做本节内容——把现网可运行、可交接、可回归写清楚并验证。
> **不做**：M2b 建群、CursorAgent 真接通、钉钉实现。  
> **完成定义**：§11.6 验收表全绿 + 本文件勾选完成；再另开 M2b。

### 11.1 目标与交付物

| 交付物 | 说明 |
| --- | --- |
| 本文 §11 勾选完成 | 操作步骤可被第二人按文档独立跑通 |
| `bots.json` 现网正确 | 真实 agent UUID，enabled 明确 |
| 启动/停机 Runbook | 单实例、bridge + 中继顺序 |
| 飞书发版/回调备忘 | 含审批；避免再踩卡片超时 |
| 冒烟脚本/命令 | 每次重启后 5 分钟内可验 |

### 11.2 现网架构（方法前提）

```
飞书用户
  │  WS 长连接（无需公网 IP）
  │  事件：im.message.receive_v1
  │        card.action.trigger（卡片按钮，需发版+审批）
  ▼
Bridge（Node，feishu-grok-bridge）
  ├─ ACL：ALLOW_FROM fail-closed；群 REQUIRE_MENTION
  ├─ Commands：/bots /bot /new /status /help /whoami /stop …
  ├─ BindingStore：chat_id → agentId（默认 data/bindings.json）
  ├─ BotCatalog：bots.json（id = 真实 Grok Bot agent UUID）
  ├─ Session + 串行队列 + 处理中 ack（入站立刻回）
  └─ HttpBackend ─POST /turn─► Relay :8787
                                  │  body 必填 agentId
                                  │  缺失 → 400；目录未知 → 404
                                  │  禁止静默默认 Bot
                                  ▼
                               inbox/ → sendPrompt(agentId)
                                  ▼
                               指定 Grok Bot / Agent
                                  ▼
                               outbox/ → Relay 回 Bridge → 飞书卡片/文本
```

**关键不变量**

1. 一 chat 一 Agent（绑定持久化；`/new` 清历史不清绑定）
2. 切换 Bot：清会话 + epoch，旧 Agent 在途回复丢弃
3. 中继只信请求体 `agentId`，不读 `GROK_BOT_AGENT_ID` 做默认
4. 任意时刻只跑 **一个** bridge 进程（多实例会把 `/bots` 当普通聊天）

### 11.3 关键路径与配置

| 项 | 默认 / 现网约定 |
| --- | --- |
| 仓库 | `feishu-grok-bridge`（main） |
| Bot 目录 | `BOT_CATALOG_PATH` → `bots.json`（参考 `bots.example.json`） |
| 绑定文件 | `BINDING_STORE_PATH` → `data/bindings.json`（gitignore） |
| 中继 | `relay/server.mjs`，`127.0.0.1:8787`（`GROK_RELAY_PORT`） |
| HttpBackend | `GROK_BACKEND=http`，`GROK_BOT_WEBHOOK_URL=http://127.0.0.1:8787/turn` |
| Gateway | 中继读 `/home/box/agent-data/gateway.json`（`GROK_GATEWAY_JSON`） |
| 飞书应用 | `cli_aa2d797daeb81cc1`（Grok Bot）；版本含 `card.action.trigger` 须发布并审批 |

联调曾用 Bot（以现网 `bots.json` 为准）：

- A DingDing：`d84209f0-28d9-4485-86fb-85795e6510ec`
- B SE001：`ad78b5fa-4212-4476-a83a-e0ed29e5918b`

### 11.4 操作方法（Runbook）

#### A. 启动前：保证单实例

```bash
# 现网死命令（本机 2026-09-17 已用过）
pgrep -af 'dist/cli/index.js start|relay/server.mjs' || echo 'none'
# 清干净（按需；先停 bridge 再停中继）
pkill -f 'dist/cli/index.js start' || true
pkill -f 'relay/server.mjs' || true
```

- [x] 启动前无第二份 bridge（2026-09-17：清残留后只留一份 `npm start`）
- [x] 中继同样确认只监听一个 `:8787`（`node relay/server.mjs` → `listening http://127.0.0.1:8787`）

#### B. 启动顺序（建议）

1. 确认 `.env`：`GROK_BACKEND=http`、webhook 指向中继、`ALLOW_FROM` 已填
2. 确认 `bots.json` 为真实 UUID 且 `enabled: true`
3. 启动中继：`node relay/server.mjs`（或项目文档中的等价命令）
4. 启动 bridge：`npm run dev` 或 `npm start`
5. 日志应见：中继 catalog loaded / bridge WS ready、`catalogSize` 正确

- [x] 按序启动成功（2026-09-17：先 `node relay/server.mjs`，再 `npm start`）
- [x] 本机实际命令：
  - 查：`pgrep -af 'dist/cli/index.js start|relay/server.mjs'`
  - 停：`pkill -f 'dist/cli/index.js start'` 然后 `pkill -f 'relay/server.mjs'`
  - 启：`node relay/server.mjs` → `npm start`
  - 验：`curl -s http://127.0.0.1:8787/health`；日志 `ws client ready` + `catalogSize=2`

#### C. 更新 bots.json

1. 复制 `bots.example.json` → `bots.json`（若尚无）
2. 每个 `id` 换成真实 agent UUID；设 `enabled`
3. **重启 bridge + 中继**（中继启动时加载目录；bridge 亦读目录）
4. `/bots` 核对列表

- [x] 现网 `bots.json` 已核对（2026-09-17：DingDing `d84209f0-…` + SE001 `ad78b5fa-…`，enabled=2；bridge `catalogSize=2`，中继 `enabled=2`）
- [ ] 变更流程写入 README 交叉链接（可选）

#### D. 飞书卡片回调（若要用按钮）

1. 开放平台 → 事件订阅：长连接 + `card.action.trigger`
2. 版本管理 → 创建版本 → 申请发布 → **企业审批通过**
3. 未审批常见现象：点按钮「目标回调服务超时」或要求配置回调
4. M2b 建群/拉群权限另行申请：开放平台 → 应用 → 权限管理 → 搜索建群/拉群相关权限；按控制台实际权限名申请并单独审批，不与 M2a 发版绑定。

- [x] 文档写明：审批是硬条件
- [x] 命令路径 `/bot <id>` 作为无卡片时的降级（M2a 已验收）

#### E. 停机 / 重启

1. 先停 bridge，再停中继；启动时按“先中继、后 bridge”反向执行（不得双 bridge）
2. 重启后跑 §11.5 冒烟
3. 绑定文件默认保留；要重置绑定则删 `data/bindings.json`

- [x] 停机顺序写清

### 11.5 回归冒烟（每次发版/重启后，约 5 分钟）

- [ ] `/bots`：出列表/卡片；**无**「处理中→backend Error」
- [ ] `/bot <A>` → 发一句能聊；有「正在处理中」再最终回复
- [ ] `/bot <B>` → 提示绑定切换；会话清；新消息打到 B
- [ ] （可选）卡片点选 Bot 一次
- [x] （可选）中继：缺 agentId → 400；假 UUID → 404（2026-09-16：`npm run relay:smoke`）

### 11.6 Ops 验收表（本步硬门禁）

| # | 项 | 负责人 | 状态 |
| --- | --- | --- | --- |
| O1 | 单实例启动写清且可复现 | DingDing | ✅ 死命令已写入 11.4 A/B（2026-09-17） |
| O2 | `bots.json` 真实 UUID + 加载验证 | DingDing | ✅ 现网 2 个 UUID，catalogSize=2（2026-09-17） |
| O3 | 发版/卡片回调/审批备忘完整 | DingDing + 产品 | ⬜ |
| O4 | 坏/缺 agentId 必 4xx（有命令可复测） | DingDing + 审核 | ✅ 代码 smoke（2026-09-16） |
| O5 | §11.5 冒烟全绿一次并记录日期 | William 或指定人 | ⬜ |
| O6 | M2b 建群权限**单独**申请路径写明（只文档，不开发） | 产品 + DingDing | ⬜ |

### 11.7 工作拆分（轻量）

| 角色 | 动作 |
| --- | --- |
| 产品经理 | 锁定范围；维护本 §11；验收口径 |
| DingDing to Grok Bot | 补现网命令、路径、实际 pgrep/启动行；跑中继 4xx 复测 |
| Software Engineer 001 | 核对 README 与代码路径一致；必要时小 PR 修文档 |
| 开发审核工程师 | 按 O1–O5 收口；不通过则指出缺哪条可执行步骤 |
| William | 需要时做飞书冒烟；拍板 Ops 完成后是否开 M2b |

### 11.8 完成后才允许

- 开 M2b（多选组群 + @ 路由）评估与排期
- 大改中继/网关协议

---

## 8. M2b 草稿（仅占位，本轮不开发）

- [ ] 多选 Bot → 建群 / 拉机器人入群
- [ ] 群内 @ 路由到对应 agent；会话隔离策略
- [ ] 群 ACL / `ALLOW_CHATS` 与多 bot 共存
- [ ] **前置**：飞书建群与入群权限单独开好，不与功能 PR 绑死

---

## 9. 风险与依赖

- 中继必须请求级 `agentId`，否则选择器无意义
- 交互卡片依赖飞书权限与回调；命令路径作降级
- 切换清会话与串行队列交互复杂，须专项测试验收①
- 坏 agentId 静默落默认是安全事故，验收②一票否决

---

## 10. 开干检查清单（Kickoff）

- [x] William 确认开干 M2a
- [x] 初始 Bot 名单就绪（DingDing + SE001）
- [x] 分支与 PR 策略确认（PR #5 含 bridge + 中继）
- [x] 本文件保持为唯一执行清单；进度每日回填勾选
