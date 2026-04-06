/**
 * SceneProgressHandle — 场景加载进度句柄内部实现
 *
 * 对外暴露 ISceneProgressHandle 接口，对内提供供 SceneSystem 驱动的
 * _update / _complete / _fail / _markCancelled 方法。
 *
 * 设计原则：
 *   - 回调注册与触发解耦：注册时若已完成/失败，立即同步触发。
 *   - 进度回调幂等保护：相同进度值不重复触发，减少无效调用。
 *   - 进度=1 单次推送保证：_complete() 仅在 _update() 尚未推送 1.0 时才补发，
 *     避免 onUpdate 轮询与 _complete() 在同一帧末尾造成双重触发。
 *   - 迭代快照安全：_update() 使用 captured-length 循环，防止回调内追加新订阅者
 *     导致当帧意外执行新回调。
 *   - 所有回调均包裹在 try/catch 中，防止用户代码异常污染加载流程。
 */

// Bug Fix: 必须使用值导入（非 import type），才能在运行时引用 SceneLoadFailReason.Cancelled 常量。
// 若仅 import type，编译后常量不存在，只能靠字符串字面量 + as 强转绕过类型系统。
import { SceneLoadFailReason }    from "./SceneTypes";
import type { ISceneProgressHandle } from "./SceneTypes";

// ─── 内部回调类型 ─────────────────────────────────────────────────────────────

type ProgressCb = (progress: number) => void;
type CompleteCb = () => void;
type ErrorCb    = (reason: SceneLoadFailReason, message: string) => void;

// ─── SceneProgressHandle ──────────────────────────────────────────────────────

export class SceneProgressHandle implements ISceneProgressHandle {

    // ── 公开只读属性 ──────────────────────────────────────────────────────────

    readonly key: string;

    private _progress:    number  = 0;
    private _isDone:      boolean = false;
    private _isCancelled: boolean = false;
    private _error:       string | null = null;
    private _failReason:  SceneLoadFailReason | null = null;

    get progress():    number           { return this._progress;    }
    get isDone():      boolean          { return this._isDone;      }
    get isCancelled(): boolean          { return this._isCancelled; }
    get error():       string | null    { return this._error;       }

    // ── 回调队列 ──────────────────────────────────────────────────────────────

    private readonly _progressCbs: ProgressCb[] = [];
    private readonly _completeCbs: CompleteCb[] = [];
    private readonly _errorCbs:    ErrorCb[]    = [];

    // ─────────────────────────────────────────────────────────────────────────

    constructor(key: string) {
        this.key = key;
    }

    // ── ISceneProgressHandle 公开接口 ─────────────────────────────────────────

    onProgress(cb: ProgressCb): this {
        if (this._isDone) {
            this._safeCall(() => cb(this._progress));
        } else {
            this._progressCbs.push(cb);
        }
        return this;
    }

    onComplete(cb: CompleteCb): this {
        if (this._isDone && this._error === null && !this._isCancelled) {
            this._safeCall(cb);
        } else if (!this._isDone) {
            this._completeCbs.push(cb);
        }
        return this;
    }

    onError(cb: ErrorCb): this {
        if (this._isDone && (this._error !== null || this._isCancelled)) {
            const reason  = this._failReason!;
            const message = this._error ?? "cancelled";
            this._safeCall(() => cb(reason, message));
        } else if (!this._isDone) {
            this._errorCbs.push(cb);
        }
        return this;
    }

    cancel(): void {
        if (!this._isDone) {
            this._isCancelled = true;
        }
    }

    // ── 框架内部驱动接口（以下方法仅供 SceneSystem 调用）────────────────────

    /**
     * 更新进度值并通知已注册的 onProgress 回调。
     * 相同进度值不重复触发。
     *
     * 迭代安全：使用 captured-length 循环，防止回调内追加新订阅者被意外执行。
     */
    _update(progress: number): void {
        if (this._isDone) return;
        const clamped = Math.min(1, Math.max(0, progress));
        if (clamped === this._progress) return;
        this._progress = clamped;
        // 使用 captured-length 而非 for-of，防止回调内 onProgress() 追加的新项被当帧执行
        const cbs = this._progressCbs;
        for (let i = 0, len = cbs.length; i < len; i++) {
            const cb = cbs[i];
            this._safeCall(() => cb(clamped));
        }
    }

    /**
     * 标记加载成功完成，触发 onComplete 回调。
     *
     * 进度=1 推送规则：
     *   - 若 onUpdate 已通过 _update(1.0) 将进度推至 1，跳过 progressCbs 通知，避免双重触发。
     *   - 若尚未到达 1（加载瞬间完成 / 过渡延迟），补发一次 progress=1。
     * 两种情况下 _progress 均保证在回调触发前已设置为 1。
     */
    _complete(): void {
        if (this._isDone) return;
        this._isDone = true;

        const needsProgressPush = this._progress < 1;
        this._progress = 1;

        if (needsProgressPush) {
            const cbs = this._progressCbs;
            for (let i = 0, len = cbs.length; i < len; i++) {
                const cb = cbs[i];
                this._safeCall(() => cb(1));
            }
        }

        for (const cb of this._completeCbs) {
            this._safeCall(cb);
        }
        this._clearCallbacks();
    }

    /**
     * 标记加载失败，触发 onError 回调。
     */
    _fail(reason: SceneLoadFailReason, message: string): void {
        if (this._isDone) return;
        this._isDone     = true;
        this._error      = message;
        this._failReason = reason;
        for (const cb of this._errorCbs) {
            this._safeCall(() => cb(reason, message));
        }
        this._clearCallbacks();
    }

    /**
     * 由 SceneSystem 在确认取消后调用，正式标记为已取消并触发 onError。
     * 使用 SceneLoadFailReason.Cancelled 常量（需值导入，不能 import type）。
     */
    _markCancelled(): void {
        if (this._isDone) return;
        this._isCancelled = true;
        this._fail(SceneLoadFailReason.Cancelled, "Scene load was cancelled.");
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    private _safeCall(fn: () => void): void {
        try {
            fn();
        } catch (e) {
            console.error(`[SceneProgressHandle] Callback error for "${this.key}":`, e);
        }
    }

    private _clearCallbacks(): void {
        this._progressCbs.length = 0;
        this._completeCbs.length = 0;
        this._errorCbs.length    = 0;
    }
}
