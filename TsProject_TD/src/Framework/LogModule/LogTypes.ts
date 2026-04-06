/**
 * LogTypes — 日志系统公共类型定义
 *
 * 设计原则：
 *   - 仅包含对外暴露的枚举与接口，与内部实现完全解耦
 *   - 内部数据结构（ChannelEntry）不在此文件中，见 LogSystem.ts
 */

// ─── 日志等级 ──────────────────────────────────────────────────────────────────

/**
 * 日志等级（分类）
 * - Debug : 调试信息，仅开发阶段使用
 * - Info  : 普通运行信息
 * - Warn  : 警告，功能仍可运行但存在隐患
 * - Error : 错误，功能已受影响
 */
export const LogLevel = {
    Debug: "debug",
    Info:  "info",
    Warn:  "warn",
    Error: "error",
} as const;

export type LogLevel = typeof LogLevel[keyof typeof LogLevel];

// ─── 通道句柄接口 ──────────────────────────────────────────────────────────────

/**
 * 日志通道句柄
 * 通过 registerChannel() 返回，持有对该通道的控制权与便捷打印接口。
 */
export interface ILogChannelHandle {
    /** 通道唯一 ID */
    readonly id: string;
    /** 通道显示名称 */
    readonly name: string;
    /** 该通道当前是否启用 */
    readonly isEnabled: boolean;

    /** 启用此通道 */
    enable(): void;
    /** 禁用此通道（屏蔽打印） */
    disable(): void;
    /** 切换启用/禁用状态 */
    toggle(): void;

    /** 在此通道打印 Debug 级别日志 */
    debug(message: string, ...args: unknown[]): void;
    /** 在此通道打印 Info 级别日志 */
    info(message: string, ...args: unknown[]): void;
    /** 在此通道打印 Warn 级别日志 */
    warn(message: string, ...args: unknown[]): void;
    /** 在此通道打印 Error 级别日志 */
    error(message: string, ...args: unknown[]): void;
}

// ─── 系统接口 ──────────────────────────────────────────────────────────────────

/**
 * 日志系统对外接口（面向接口编程，便于 Mock / 替换实现）
 *
 * 两层过滤机制：
 *   1. 日志等级开关 — 关闭某等级后，所有通道的该等级打印均被屏蔽
 *   2. 通道开关     — 关闭某通道后，该通道的所有等级打印均被屏蔽
 */
export interface ILogSystem {

    // ── 日志等级开关 ──────────────────────────────────────────────────────────

    /** 启用指定等级的打印 */
    enableLevel(level: LogLevel): void;
    /** 禁用指定等级的打印 */
    disableLevel(level: LogLevel): void;
    /** 查询指定等级是否已启用 */
    isLevelEnabled(level: LogLevel): boolean;

    // ── 通道管理 ──────────────────────────────────────────────────────────────

    /**
     * 注册一个日志通道并返回其句柄。
     * 若同 id 通道已存在则直接返回已有句柄（幂等）。
     * @param id    通道唯一标识符
     * @param name  通道显示名称（省略时默认使用 id）
     */
    registerChannel(id: string, name?: string): ILogChannelHandle;

    /**
     * 通过 id 启用一个通道。
     * 若该 id 对应的通道不存在，则静默忽略。
     */
    enableChannel(id: string): void;

    /**
     * 通过 id 禁用（屏蔽）一个通道。
     * 若该 id 对应的通道不存在，则静默忽略。
     */
    disableChannel(id: string): void;

    /** 是否存在指定 id 的通道 */
    hasChannel(id: string): boolean;

    /**
     * 获取指定 id 通道的句柄，不存在时返回 undefined。
     */
    getChannel(id: string): ILogChannelHandle | undefined;

    // ── 全局打印（走默认通道） ────────────────────────────────────────────────

    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
