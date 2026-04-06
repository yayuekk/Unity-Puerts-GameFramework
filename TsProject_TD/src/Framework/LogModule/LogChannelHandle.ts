/**
 * LogChannelHandle — 日志通道句柄
 *
 * 职责：
 *   - 持有通道元数据（id / name）
 *   - 通过 ILogDispatcher 将打印请求和启用/禁用指令回调给 LogSystem
 *
 * 设计：
 *   句柄本身无状态，LogSystem 是通道启用状态的唯一来源，
 *   isEnabled 每次实时查询调度器，确保与系统状态严格同步。
 */

import type { ILogChannelHandle, LogLevel } from "./LogTypes";

// ─── 调度器接口（供 LogSystem 实现，避免循环依赖） ─────────────────────────────

/**
 * LogSystem 暴露给 LogChannelHandle 的内部回调接口。
 * 与 TimerHandle → ITimerController 的模式一致。
 */
export interface ILogDispatcher {
    /** 分发一条日志，由 LogSystem 执行等级过滤与实际输出 */
    dispatchLog(channelId: string, level: LogLevel, message: string, args: unknown[]): void;
    /** 设置通道的启用状态 */
    setChannelEnabled(channelId: string, enabled: boolean): void;
    /** 查询通道当前是否启用（LogSystem 是状态唯一来源） */
    isChannelEnabled(channelId: string): boolean;
}

// ─── 具体实现 ──────────────────────────────────────────────────────────────────

export class LogChannelHandle implements ILogChannelHandle {

    private readonly _dispatcher: ILogDispatcher;
    private readonly _id: string;
    private readonly _name: string;

    constructor(dispatcher: ILogDispatcher, id: string, name: string) {
        this._dispatcher = dispatcher;
        this._id = id;
        this._name = name;
    }

    get id(): string   { return this._id;   }
    get name(): string { return this._name; }

    /** 实时从 LogSystem 查询，保证与外部调用 enableChannel/disableChannel 同步 */
    get isEnabled(): boolean {
        return this._dispatcher.isChannelEnabled(this._id);
    }

    enable(): void  { this._dispatcher.setChannelEnabled(this._id, true);  }
    disable(): void { this._dispatcher.setChannelEnabled(this._id, false); }

    toggle(): void {
        this._dispatcher.setChannelEnabled(this._id, !this.isEnabled);
    }

    debug(message: string, ...args: unknown[]): void {
        this._dispatcher.dispatchLog(this._id, "debug", message, args);
    }

    info(message: string, ...args: unknown[]): void {
        this._dispatcher.dispatchLog(this._id, "info", message, args);
    }

    warn(message: string, ...args: unknown[]): void {
        this._dispatcher.dispatchLog(this._id, "warn", message, args);
    }

    error(message: string, ...args: unknown[]): void {
        this._dispatcher.dispatchLog(this._id, "error", message, args);
    }
}
