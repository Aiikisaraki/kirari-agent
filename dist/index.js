"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./types"), exports);
__exportStar(require("./schema"), exports);
__exportStar(require("./store"), exports);
__exportStar(require("./inject"), exports);
__exportStar(require("./projector"), exports);
__exportStar(require("./recorder"), exports);
__exportStar(require("./profile"), exports);
__exportStar(require("./runner"), exports);
__exportStar(require("./tasks"), exports);
__exportStar(require("./jobs"), exports);
__exportStar(require("./capability"), exports);
__exportStar(require("./skill"), exports);
//# sourceMappingURL=index.js.map