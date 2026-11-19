# kirari-agent

Kirari 内核共享层。核心版（`kirari-core`，CommonJS）与桌面版（`kirari-desktop`，Electron 主进程）**共用同一份实现**，避免两份复制内核各自演进。

## 这一层负责什么

- `session_events` 事件流的 schema 与 DDL 文本（唯一真源）
- `inject()` 显式上下文注入，替换过去把人格 / 简报 / 知识库 / 技能拼成一条字符串的做法
- `deriveMessages()` 投影：从事件流重建「发给模型的 messages」与「UI 可见历史」
- `EventRecorder` 旁路队列：批量落库、失败不冒泡

## 硬边界

- **不依赖任何运行时包**（`dependencies` 为空）。特别是**不 require `better-sqlite3` / `ws` / `electron` / `openai`**。
- 数据库由两端各自持有，通过 `EventStore` 接口注入。理由：核心版与桌面端是**两个进程直写同一个 `pet_sessions.db`**，原生模块在 Electron 侧需要单独 rebuild，放进共享包会让两端能力不再对等。
- 两端之间存在 WS 通道的假设不成立：桌面版已自带内核、不连核心版 `/ws`。跨进程只靠「读同一份 DB」。

## 使用

两端按**发版标签**引用：`"kirari-agent": "https://codeload.github.com/Aiikisaraki/kirari-agent/tar.gz/refs/tags/v0.5.0"`。
构建产物是 CommonJS（`dist/index.js`），核心版直接 `require`，桌面版由 vite 打包消费。

因此**改完本包必须打新 tag 并改两端的引用版本号**，两端才会拿到新代码 —— `npm ci` 装的是那个
标签的 tarball，不是工作区目录。想在本地联调不走 tag，可临时把两端改成 `file:../kirari-agent`，
但**不要提交**：那会让 CI 与别人机器上的目录结构成为隐性依赖。

> 注意与 `kirari-net` 的区别：`kirari-net` 是 `file:../kirari-net` 平级引用，改源码立刻生效。
