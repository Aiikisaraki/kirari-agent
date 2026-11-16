import type { AgentProfile } from "./profile";
/** 一轮的结果：有最终文本（无欠账）或本轮领取的工具调用（有欠账，已回灌）。 */
export type AgentStepResult<T> = {
    kind: "final";
    value: T;
} | {
    kind: "tools";
    toolCallIds: string[];
} | {
    kind: "continue";
    reason: string;
};
/**
 * 工具循环驱动器。
 *
 * 账本语义：
 *   - note(id)    模型本轮领取的 tool_call，结果必须回灌才能进下一轮
 *   - settle(id)  该 tool_call 的结果已回灌到 messages
 *   - hasDebt()   账本非空 = turn 仍欠工作，不能关闭
 *
 * 两端在每轮工具执行后 note→settle，因此轮次边界上账本为空。阶段 C 的
 * 任务欠账走独立的 continue 信号（宿主查 TaskStore），不进这个账本。
 */
export declare class AgentRunner<T> {
    readonly profile: AgentProfile;
    private readonly pending;
    private currentRound;
    constructor(profile: AgentProfile);
    get round(): number;
    /** 账本非空 = 仍欠未回灌的工具调用 / 未完成任务。 */
    hasDebt(): boolean;
    get pendingCount(): number;
    /** 领取欠账：模型返回了这些 tool_call，必须逐一回灌。 */
    note(ids: readonly string[]): void;
    /** 清偿欠账：该 tool_call 的结果已回灌到 messages。 */
    settle(id: string): void;
    /** 清空账本（阶段 C 的任务完成后调用，或异常收尾）。 */
    clear(): void;
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
    run(step: (round: number, runner: AgentRunner<T>) => Promise<AgentStepResult<T>>): Promise<T>;
}
