/**
 * TimerTypes — 计时器模块公共类型定义
 *
 * 设计原则：
 *   - 仅包含对外暴露的枚举、接口，与内部实现完全解耦
 *   - 内部数据结构（TimerEntry）不在此文件中，见 TimerEntry.ts
 */

// ─── 计时器类型 ────────────────────────────────────────────────────────────────

/** 计时器驱动类型 */
export const TimerType = {
    /** 按帧触发：每 N 帧触发一次（与帧率强相关） */
    Frame: "frame",
    /** 按秒触发：每 N 秒触发一次 */
    Second: "second",
    /** 按分钟触发：每 N 分钟触发一次 */
    Minute: "minute",
} as const;

export type TimerType = typeof TimerType[keyof typeof TimerType];

// ─── 句柄接口 ──────────────────────────────────────────────────────────────────

/**
 * 计时器句柄
 * 通过 addXxxTimer() 返回，持有对该计时器的控制权。
 */
export interface ITimerHandle {
    /** 计时器唯一 ID */
    readonly id: number;
    /** 是否仍在系统中存活（未取消 & 未自然结束） */
    readonly isActive: boolean;
    /** 是否处于暂停状态 */
    readonly isPaused: boolean;
    /** 取消并从系统中移除该计时器 */
    cancel(): void;
    /** 暂停：保留进度，不计时、不触发 */
    pause(): void;
    /** 恢复暂停 */
    resume(): void;
    /** 重置本轮计时进度（剩余触发次数不变） */
    reset(): void;
}

// ─── 系统接口 ──────────────────────────────────────────────────────────────────

/** 计时器系统对外接口（面向接口编程，便于 Mock / 替换实现） */
export interface ITimerSystem {
    /**
     * 添加帧计时器，每 interval 帧触发一次。
     * @param interval  触发间隔（帧，>= 1，非整数将向下取整）
     * @param callback  触发回调
     * @param repeat    触发总次数（0 = 无限循环；默认 1 = 触发一次后自动移除）
     */
    addFrameTimer(interval: number, callback: () => void, repeat?: number): ITimerHandle;

    /**
     * 添加秒计时器，每 interval 秒触发一次。
     * @param interval  触发间隔（秒，> 0）
     * @param callback  触发回调
     * @param repeat    触发总次数（0 = 无限循环；默认 1）
     */
    addSecondTimer(interval: number, callback: () => void, repeat?: number): ITimerHandle;

    /**
     * 添加分钟计时器，每 interval 分钟触发一次。
     * @param interval  触发间隔（分钟，> 0）
     * @param callback  触发回调
     * @param repeat    触发总次数（0 = 无限循环；默认 1）
     */
    addMinuteTimer(interval: number, callback: () => void, repeat?: number): ITimerHandle;

    /** 通过 ID 移除计时器，返回是否找到并移除成功 */
    removeTimer(id: number): boolean;
    /** 暂停指定计时器 */
    pauseTimer(id: number): void;
    /** 恢复指定计时器 */
    resumeTimer(id: number): void;
    /** 重置指定计时器的本轮计时进度 */
    resetTimer(id: number): void;
    /** 清除所有计时器 */
    clearAll(): void;
    /** 当前活跃（未结束、未取消）的计时器数量 */
    readonly activeCount: number;
}
