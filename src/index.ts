// kirari-agent · 内核共享层公共入口
//
// 两个平级仓库共用这一份实现（能力对等是硬约束）：
//   - kirari-core     核心版（纯 CJS，直接 require）
//   - kirari-desktop  桌面桌宠（vite 打包进 Electron 主进程）
//
// ⚠️ 本层不得 import electron / better-sqlite3 / ws / openai。
//    数据库由两端各自持有，通过 EventStore 接口注入；本包只做纯逻辑。
//
// 导出顺序即依赖方向：types → schema/store → inject → projector → recorder。

export * from "./types";
export * from "./schema";
export * from "./store";
export * from "./inject";
export * from "./projector";
export * from "./recorder";
