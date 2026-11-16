import { defineConfig } from "vitest/config";

// 本包只放纯逻辑（事件 schema / 投影 / 队列），测试用内存 EventStore，
// 不连数据库、不依赖 Electron、不占固定端口，因此可以并行跑。
export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.spec.ts"],
    },
});
