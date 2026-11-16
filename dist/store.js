"use strict";
// EventStore 是**纯契约**，不含任何数据库类型或依赖。
//
// 为什么这样切：核心版与桌面端各自持有已存在的 better-sqlite3 连接，
// 各自实现一个适配器注入进来。共享包因此不需要碰原生模块，
// 也就不会有「Electron 主进程要单独 rebuild」的问题（两端能力对等）。
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_EVENT_QUERY_LIMIT = exports.DEFAULT_EVENT_QUERY_LIMIT = void 0;
exports.DEFAULT_EVENT_QUERY_LIMIT = 500;
exports.MAX_EVENT_QUERY_LIMIT = 2000;
//# sourceMappingURL=store.js.map