/**
 * LogSystem — 日志系统核心
 *
 * 职责：管理日志等级开关与自定义通道的生命周期，执行两层过滤后输出到控制台。
 *
 * 两层过滤机制（任一命中则静默丢弃该条日志）：
 *   1. 等级过滤 — disableLevel(LogLevel.Info) 后，所有通道的 Info 打印均静默
 *   2. 通道过滤 — disableChannel("network") 后，该通道的所有打印均静默
 *
 * 默认通道：
 *   系统初始化后自动注册 id 为 "default" 的通道，
 *   直接调用 log.info() / log.warn() 等方法时走此通道。
 */

import type { GameFramework, IModule } from "../GameFramework";
import type { ILogChannelHandle, ILogSystem, LogLevel } from "./LogTypes";
import type { ILogDispatcher } from "./LogChannelHandle";
import { LogChannelHandle } from "./LogChannelHandle";

// ─── 通道内部数据结构 ──────────────────────────────────────────────────────────

interface ChannelEntry {
    enabled: boolean;
    handle: LogChannelHandle;
}

// ─── 等级元数据（仅内部使用） ──────────────────────────────────────────────────

interface LevelMeta {
    /** Unity 富文本颜色标签色值 */
    color: string;
    /** 日志等级标识前缀 */
    tag: string;
}

const LEVEL_META: Readonly<Record<LogLevel, LevelMeta>> = {
    debug: { tag: "[DEBUG]", color: "#B8B8B8" },   // 灰白
    info:  { tag: "[INFO] ", color: "#57E87A" },   // 绿色
    warn:  { tag: "[WARN] ", color: "#FFD060" },   // 黄色
    error: { tag: "[ERROR]", color: "#FF5555" },   // 红色
};

// ─── LogSystem ─────────────────────────────────────────────────────────────────

export class LogSystem implements IModule, ILogSystem, ILogDispatcher {

    readonly moduleName = "LogSystem";

    /** 默认通道 ID，直接调用 debug/info/warn/error 时使用 */
    static readonly DEFAULT_CHANNEL = "default";

    private readonly _disabledLevels = new Set<LogLevel>();
    private readonly _channels       = new Map<string, ChannelEntry>();

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(_fw: GameFramework): void {
        this.registerChannel(LogSystem.DEFAULT_CHANNEL, "Default");
    }

    onShutdown(): void {
        this._channels.clear();
        this._disabledLevels.clear();
    }

    // ── ILogSystem — 等级开关 ─────────────────────────────────────────────────

    enableLevel(level: LogLevel): void {
        this._disabledLevels.delete(level);
    }

    disableLevel(level: LogLevel): void {
        this._disabledLevels.add(level);
    }

    isLevelEnabled(level: LogLevel): boolean {
        return !this._disabledLevels.has(level);
    }

    // ── ILogSystem — 通道管理 ─────────────────────────────────────────────────

    registerChannel(id: string, name?: string): ILogChannelHandle {
        const existing = this._channels.get(id);
        if (existing) return existing.handle;

        const channelName = name ?? id;
        const handle = new LogChannelHandle(this, id, channelName);
        this._channels.set(id, { enabled: true, handle });
        return handle;
    }

    enableChannel(id: string): void {
        const entry = this._channels.get(id);
        if (entry) entry.enabled = true;
        // 若 id 不存在则静默忽略
    }

    disableChannel(id: string): void {
        const entry = this._channels.get(id);
        if (entry) entry.enabled = false;
        // 若 id 不存在则静默忽略
    }

    hasChannel(id: string): boolean {
        return this._channels.has(id);
    }

    getChannel(id: string): ILogChannelHandle | undefined {
        return this._channels.get(id)?.handle;
    }

    // ── ILogSystem — 全局快捷打印（走默认通道） ───────────────────────────────

    debug(message: string, ...args: unknown[]): void {
        this.dispatchLog(LogSystem.DEFAULT_CHANNEL, "debug", message, args);
    }

    info(message: string, ...args: unknown[]): void {
        this.dispatchLog(LogSystem.DEFAULT_CHANNEL, "info", message, args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.dispatchLog(LogSystem.DEFAULT_CHANNEL, "warn", message, args);
    }

    error(message: string, ...args: unknown[]): void {
        this.dispatchLog(LogSystem.DEFAULT_CHANNEL, "error", message, args);
    }

    // ── ILogDispatcher（供 LogChannelHandle 回调） ────────────────────────────

    dispatchLog(channelId: string, level: LogLevel, message: string, args: unknown[]): void {
        // 第一层：等级过滤
        if (this._disabledLevels.has(level)) return;

        // 第二层：通道过滤
        const entry = this._channels.get(channelId);
        if (!entry || !entry.enabled) return;

        const meta   = LEVEL_META[level];
        const prefix = `[${entry.handle.name}]${meta.tag} `;
        this._output(level, meta.color, prefix, message, args);
    }

    setChannelEnabled(channelId: string, enabled: boolean): void {
        const entry = this._channels.get(channelId);
        if (entry) entry.enabled = enabled;
    }

    isChannelEnabled(channelId: string): boolean {
        return this._channels.get(channelId)?.enabled ?? false;
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    private _output(
        level: LogLevel,
        color: string,
        prefix: string,
        message: string,
        args: unknown[],
    ): void {
        const body = args.length > 0
            ? `${message} ${args.map(a => {
                if (typeof a !== "object" || a === null) return String(a);
                try { return JSON.stringify(a); } catch { return String(a); }
            }).join(" ")}`
            : message;

        // 用 Unity 富文本标签对整条日志着色
        const colored = `<color=${color}>${prefix}${body}</color>`;

        switch (level) {
            case "warn":  console.warn(colored);  break;
            case "error": console.error(colored); break;
            default:      console.log(colored);   break;
        }
    }
}
