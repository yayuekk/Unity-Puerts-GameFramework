/**
 * TimerHandle — 计时器句柄（Handle Pattern）
 *
 * 职责：为调用方提供对单个计时器的控制入口，屏蔽内部 ID 管理细节。
 *
 * 依赖倒置：Handle 不直接依赖 TimerSystem 具体类，而是依赖 ITimerController 接口，
 * 彻底消除句柄与主系统之间的循环依赖风险，也方便单元测试时注入 Mock。
 */

import type { ITimerHandle } from "./TimerTypes";

// ─── 系统控制接口（仅供 TimerHandle 使用）────────────────────────────────────

/**
 * TimerSystem 需要实现此接口，供 TimerHandle 回调。
 * 只暴露句柄所需的最小操作集，遵循接口隔离原则。
 */
export interface ITimerController {
    isTimerActive(id: number): boolean;
    isTimerPaused(id: number): boolean;
    removeTimer(id: number): boolean;
    pauseTimer(id: number): void;
    resumeTimer(id: number): void;
    resetTimer(id: number): void;
}

// ─── 句柄实现 ──────────────────────────────────────────────────────────────────

export class TimerHandle implements ITimerHandle {

    constructor(
        private readonly _controller: ITimerController,
        public readonly id: number,
    ) {}

    get isActive(): boolean { return this._controller.isTimerActive(this.id); }
    get isPaused(): boolean { return this._controller.isTimerPaused(this.id); }

    cancel(): void { this._controller.removeTimer(this.id); }
    pause(): void  { this._controller.pauseTimer(this.id); }
    resume(): void { this._controller.resumeTimer(this.id); }
    reset(): void  { this._controller.resetTimer(this.id); }
}
