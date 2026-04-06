/**
 * TickStrategy — 计时驱动策略（Strategy Pattern）
 *
 * 职责：封装"如何推进计时器进度 & 触发后如何重置"，与 TimerSystem 主逻辑解耦。
 * 扩展：新增计时类型只需实现 ITickStrategy 并在 getStrategy 中注册，不修改主系统。
 */

import type { TimerEntry } from "./TimerEntry";
import { TimerType } from "./TimerTypes";

// ─── 策略接口 ──────────────────────────────────────────────────────────────────

export interface ITickStrategy {
    /**
     * 推进计时器进度。
     * @returns 本帧是否达到触发条件
     */
    tick(entry: TimerEntry, deltaTime: number): boolean;

    /**
     * 触发后重置：保留超出部分（elapsed -= interval），消除累计误差。
     * 不直接归零，确保高频帧下的时序精度。
     */
    afterFire(entry: TimerEntry): void;
}

// ─── 策略实现 ──────────────────────────────────────────────────────────────────

/** 帧策略：每帧 elapsed + 1，与实际时间无关 */
class FrameTickStrategy implements ITickStrategy {
    tick(entry: TimerEntry, _dt: number): boolean {
        entry.elapsed++;
        return entry.elapsed >= entry.interval;
    }

    afterFire(entry: TimerEntry): void {
        entry.elapsed -= entry.interval;
    }
}

/**
 * 时间策略：每帧 elapsed += deltaTime（单位：秒）
 * Second 和 Minute 均使用此策略（Minute 在创建时已将 interval 转为秒）
 */
class TimeTickStrategy implements ITickStrategy {
    tick(entry: TimerEntry, dt: number): boolean {
        entry.elapsed += dt;
        return entry.elapsed >= entry.interval;
    }

    afterFire(entry: TimerEntry): void {
        entry.elapsed -= entry.interval;
    }
}

// ─── 策略工厂 ──────────────────────────────────────────────────────────────────

const _frame: ITickStrategy = new FrameTickStrategy();
const _time: ITickStrategy  = new TimeTickStrategy();

/**
 * 根据计时器类型返回对应策略单例。
 * Minute 类型在创建时已将 interval 转为秒，运行时与 Second 共用同一策略，无额外分支。
 */
export function getStrategy(type: TimerType): ITickStrategy {
    return type === TimerType.Frame ? _frame : _time;
}
