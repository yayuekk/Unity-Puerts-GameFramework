/**
 * TimerEntry — 计时器内部数据结构（不对外导出）
 *
 * 所有字段均可变，由 TimerSystem 在 tick 过程中直接读写，
 * 避免 readonly 约束导致的无意义类型断言。
 *
 * - Frame 类型：interval / elapsed 单位为帧数
 * - Second / Minute 类型：interval / elapsed 单位为秒（Minute 在创建时已完成转换）
 */

import type { TimerType } from "./TimerTypes";

export interface TimerEntry {
    id: number;
    type: TimerType;
    /** 触发间隔（Frame=帧；Second/Minute=秒，Minute 创建时已转换） */
    interval: number;
    /** 当前已累计值，触发后保留超出量（elapsed -= interval），消除累计误差 */
    elapsed: number;
    /**
     * 剩余触发次数
     *  -1 = 无限循环
     *   n = 还剩 n 次（归零后自动移除）
     */
    remaining: number;
    callback: () => void;
    paused: boolean;
    pendingRemove: boolean;
}
