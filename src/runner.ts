// src/runner.ts
// AgentRunner：把两端的「工具调用循环」抽成可注入 IO 的纯逻辑驱动器。
//
// 停止条件语义化（用户拍板）：一个 turn 在「不再欠下任何工作」时关闭。
//   - 模型返回纯文本        → 无欠账 → turn 关闭 → 返回最终结果
//   - 模型返回 tool_calls   → 产生欠账（结果必须回灌）→ 回灌后进入下一轮
//   - 欠账连续产生到上限    → maxRounds 熔断（安全上限，不再当「目标轮数」）
//
// 为什么 IO 走回调：包只放纯逻辑（用户拍板），模型调用 / 工具执行 / 事件记录
// 全由两端在 step 回调里做；runner 只决定「下一轮还是收尾」并维护账本。
// 这也是阶段 C 的挂接点：外部任务（goal_set/task_*）可 note 到账本，
// 让 turn 为「主动做事」保持打开，而不改两端主链路。

import type { AgentProfile } from "./profile";

/** 一轮的结果：有最终文本（无欠账）或本轮领取的工具调用（有欠账，已回灌）。 */
export type AgentStepResult<T> =
    | { kind: "final"; value: T }
    | { kind: "tools"; toolCallIds: string[] };

/**
 * 工具循环驱动器。
 *
 * 账本语义：
 *   - note(id)    模型本轮领取的 tool_call，结果必须回灌才能进下一轮
 *   - settle(id)  该 tool_call 的结果已回灌到 messages
 *   - hasDebt()   账本非空 = turn 仍欠工作，不能关闭
 *
 * 本阶段（B）两端在每轮工具执行后 note→settle，因此轮次边界上账本为空；
 * 账本真正被外部写入是阶段 C（task_* 事件消费者）。
 */
export class AgentRunner<T> {
    readonly profile: AgentProfile;
    private readonly pending = new Set<string>();
    private currentRound = 0;

    constructor(profile: AgentProfile) {
        this.profile = profile;
    }

    get round(): number {
        return this.currentRound;
    }

    /** 账本非空 = 仍欠未回灌的工具调用 / 未完成任务。 */
    hasDebt(): boolean {
        return this.pending.size > 0;
    }

    get pendingCount(): number {
        return this.pending.size;
    }

    /** 领取欠账：模型返回了这些 tool_call，必须逐一回灌。 */
    note(ids: readonly string[]): void {
        for (const id of ids) this.pending.add(id);
    }

    /** 清偿欠账：该 tool_call 的结果已回灌到 messages。 */
    settle(id: string): void {
        this.pending.delete(id);
    }

    /** 清空账本（阶段 C 的任务完成后调用，或异常收尾）。 */
    clear(): void {
        this.pending.clear();
    }

    /**
     * 驱动工具循环。
     *
     * step 回调执行一轮真实 IO，返回：
     *   - {kind:'final', value}      无欠账 → turn 关闭，返回 value
     *   - {kind:'tools', toolCallIds} 有欠账 → 校验已全部回灌后进入下一轮
     *
     * 回调抛出的错误一律向上冒泡（超时 / 空内容 / 降级失败由两端自己决定），
     * runner 不吞错、不改错文案——保持与改造前逐字一致的行为。
     */
    async run(step: (round: number, runner: AgentRunner<T>) => Promise<AgentStepResult<T>>): Promise<T> {
        // maxRounds 是熔断上限，不是目标：用 while + 显式上限，语义更清楚。
        for (let round = 0; round < this.profile.maxRounds; round++) {
            this.currentRound = round;
            const result = await step(round, this);

            if (result.kind === "final") {
                // 收尾时不允许残留欠账：有未回灌的工具结果就显式报错，
                // 避免带着脏账本关闭 turn（宁可报错，不静默丢工具结果）。
                if (this.hasDebt()) {
                    throw new Error(
                        `[AgentRunner] 收尾时仍有 ${this.pendingCount} 个未回灌的工具调用，拒绝关闭 turn`,
                    );
                }
                return result.value;
            }

            // tools 轮：欠账必须在本轮内清偿完毕才能进下一轮，否则拒绝空转。
            if (this.hasDebt()) {
                throw new Error(
                    `[AgentRunner] 第 ${round} 轮有 ${this.pendingCount} 个工具调用未回灌，拒绝进入下一轮`,
                );
            }
            if (result.toolCallIds.length === 0) {
                throw new Error("[AgentRunner] 工具轮却没有领取任何 tool_call，拒绝空转");
            }
        }

        // 与改造前 for 循环结束后的 throw 逐字一致。
        throw new Error("工具调用轮次过多，未能生成最终回复");
    }
}
