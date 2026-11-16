// kirari-agent · 内核共享层公共入口
//
// 两个平级仓库共用这一份实现（能力对等是硬约束）：
//   - kirari-core     核心版（纯 CJS，直接 require）
//   - kirari-desktop  桌面桌宠（vite 打包进 Electron 主进程）
//
// ⚠️ 本层不得 import electron / better-sqlite3 / ws / openai。
//    数据库由两端各自持有，通过 EventStore 接口注入；本包只做纯逻辑。
//
// 导出顺序即依赖方向：types → schema/store → inject → projector → recorder → profile/runner → tasks/jobs → capability/skill。
// 阶段 C：tasks / jobs 只导出类型 + 纯逻辑 + Store 契约，DB 仍由两端注入。
// 阶段 D：capability（统一注册表 + scope 隔离 + 超时/截断策略）与 skill（SKILL.md 解析）
//         仍是纯逻辑；dispatch 执行器与文件扫描由两端各自持有，本包不碰 IO。

export * from "./types";
export * from "./schema";
export * from "./store";
export * from "./inject";
export * from "./projector";
export * from "./recorder";
export * from "./profile";
export * from "./runner";
export * from "./tasks";
export * from "./jobs";
export * from "./capability";
export * from "./skill";
