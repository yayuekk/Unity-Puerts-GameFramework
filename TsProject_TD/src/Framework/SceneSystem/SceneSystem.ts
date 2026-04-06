/**
 * SceneSystem — 场景管理系统核心
 *
 * 职责：
 *   - 通过 Addressable Asset System 异步加载 / 卸载场景
 *   - 每帧轮询 AsyncOperationHandle.PercentComplete，驱动 ISceneProgressHandle 进度更新
 *   - 管理 Single / Additive 两种加载模式的生命周期
 *   - 协调场景过渡策略（ISceneTransition），解耦切换动画与加载逻辑
 *   - 对同一 key 的并发加载请求返回同一句柄，防止重复加载
 *   - Additive 模式下检测重复 key，防止 Addressable opHandle 泄漏
 *
 * 并发安全：
 *   同一 Addressable 场景 key 在加载进行中时，重复调用 loadScene 会直接返回
 *   已存在的 ISceneProgressHandle，不会发起新的底层加载请求。
 *
 * 生命周期：
 *   由 GameFramework 驱动：onInit → onUpdate（每帧）→ onShutdown
 *
 * Shutdown 安全性：
 *   onShutdown 通过 _markCancelled() 将所有进行中句柄的 isCancelled 置 true。
 *   _startLoad 协程在 await 之后的每个关键节点都检查 handle.isCancelled，
 *   确保 shutdown 后绝不向 _scenes 写入新条目。
 *
 * C# 桥接层约定：
 *   通过 require("csharp") 获取 C# 桥接（与 ResSystem / index.cts 一致），不依赖全局 CS。
 *   所有 Addressable 调用集中在文件顶部的纯函数中，与业务逻辑彻底解耦。
 *   数值常量（AsyncOperationStatus.Succeeded=1，LoadSceneMode=0/1）在注释中说明来源。
 */

import { $promise } from "puerts";

// PuerTS C# 桥接：优先使用 csharp 模块（与 index.cts / ResSystem 一致），避免依赖未注入的全局 CS
const _CS: any = (function (): any {
    try {
        return require("csharp");
    } catch {
        return typeof globalThis !== "undefined" ? (globalThis as any).CS : undefined;
    }
})();
if (typeof _CS === "undefined") {
    throw new Error("[SceneSystem] C# bridge not available: neither require('csharp') nor global CS.");
}

import type { GameFramework, IModule }       from "../GameFramework";
import type { LogSystem, ILogChannelHandle } from "../LogModule";
import type {
    ISceneSystem,
    ISceneLoadOptions,
    ISceneProgressHandle,
    ISceneTransition,
    ISceneContext,
} from "./SceneTypes";
import {
    SceneLoadMode,
    SceneState,
    SceneLoadFailReason,
} from "./SceneTypes";
import { SceneProgressHandle } from "./SceneProgressHandle";
import { NullSceneTransition }  from "./SceneTransition";

// ─── C# 桥接辅助函数 ──────────────────────────────────────────────────────────
// 所有对 Unity / Addressable API 的调用集中于此，便于版本迁移和 mock 测试。

/**
 * AddressablesBridge.LoadSceneAsync(key, loadMode)
 * loadMode: 0 = Single, 1 = Additive（对应 UnityEngine.SceneManagement.LoadSceneMode）
 * 返回 AsyncOperationHandle<SceneInstance>
 */
function addrLoadScene(key: string, loadMode: number): any {
    return _CS.AddressablesBridge.LoadSceneAsync(key, loadMode);
}

/**
 * AddressablesBridge.UnloadSceneAsync(sceneInstance)
 * sceneInstance 来自 LoadSceneAsync 结果的 opHandle.Result
 * 返回 AsyncOperationHandle<SceneInstance>
 */
function addrUnloadScene(sceneInstance: any): any {
    return _CS.AddressablesBridge.UnloadSceneAsync(sceneInstance);
}

// ─── 内部数据结构 ─────────────────────────────────────────────────────────────

/**
 * 正在加载中的条目。
 * loadMode 字段已移除：它只在 Phase 3 决策时使用（在 _startLoad 参数中已携带），
 * onUpdate 轮询不需要区分模式，保留会形成死代码。
 */
interface PendingEntry {
    /** SceneProgressHandle 实例，提供给外部观察进度 */
    handle: SceneProgressHandle;
    /**
     * Addressable AsyncOperationHandle，由 `addrLoadScene` 返回。
     * 在过渡动画阶段（onBeforeLoad）尚未发起加载时为 null，
     * null 期间 onUpdate 跳过该条目的进度轮询。
     */
    opHandle: any | null;
}

// ─── SceneSystem ──────────────────────────────────────────────────────────────

export class SceneSystem implements IModule, ISceneSystem {

    readonly moduleName = "SceneSystem";

    // ── 内部状态 ──────────────────────────────────────────────────────────────

    /** 已加载并激活的场景上下文（key → ISceneContext） */
    private readonly _scenes  = new Map<string, ISceneContext>();

    /**
     * 正在加载中的条目（key → PendingEntry）。
     * 同一 key 只允许存在一条，loadScene 重复调用返回现有 handle。
     */
    private readonly _pending = new Map<string, PendingEntry>();

    private _log?: ILogChannelHandle;

    // ── ISceneSystem 公开属性 ─────────────────────────────────────────────────

    /** 默认过渡策略，初始为空过渡，可在外部替换 */
    defaultTransition: ISceneTransition = NullSceneTransition.shared;

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(fw: GameFramework): void {
        const logSys = fw.tryGetModule<LogSystem>("LogSystem");
        this._log = logSys?.registerChannel("scene", "SceneSystem");
        this._log?.info("SceneSystem initialized.");
    }

    /**
     * 每帧轮询所有正在加载中的 AsyncOperationHandle，
     * 将 PercentComplete 推送给对应的 SceneProgressHandle。
     */
    onUpdate(_deltaTime: number): void {
        if (this._pending.size === 0) return;

        for (const entry of this._pending.values()) {
            if (entry.opHandle === null) continue;
            if (entry.handle.isDone)     continue;

            // AsyncOperationHandle.PercentComplete: float in [0, 1]
            const p: number = entry.opHandle.PercentComplete ?? 0;
            entry.handle._update(p);
        }
    }

    onShutdown(): void {
        // _markCancelled 将 isCancelled 和 isDone 均置 true。
        // _startLoad 协程在每个 await 后均检查 handle.isCancelled，
        // 确保 shutdown 后绝不执行 _scenes.set()。
        for (const entry of this._pending.values()) {
            entry.handle._markCancelled();
        }
        this._pending.clear();
        this._scenes.clear();
        this._log?.info("SceneSystem shutdown complete.");
    }

    // ── ISceneSystem 公开接口 ─────────────────────────────────────────────────

    loadScene(key: string, options?: ISceneLoadOptions): ISceneProgressHandle {
        const mode = options?.mode ?? SceneLoadMode.Single;

        // 并发保护：同一 key 已在加载中，直接返回现有句柄
        const existingPending = this._pending.get(key);
        if (existingPending) {
            this._log?.warn(`loadScene: "${key}" is already loading, returning existing handle.`);
            return existingPending.handle;
        }

        // Additive 重复加载保护：防止同一 key 重复加载导致旧 opHandle 泄漏。
        // Single 模式例外：_unloadAllTrackedScenes() 会在加载前清理旧条目。
        if (mode === SceneLoadMode.Additive && this._scenes.has(key)) {
            this._log?.warn(`loadScene: "${key}" is already active in Additive mode. Return completed handle.`);
            const already = new SceneProgressHandle(key);
            already._complete();
            return already;
        }

        const transition = options?.transition ?? this.defaultTransition;
        const handle     = new SceneProgressHandle(key);
        const entry: PendingEntry = { handle, opHandle: null };
        this._pending.set(key, entry);

        // 启动异步加载流程，不阻塞当前调用
        this._startLoad(key, handle, entry, mode, transition).catch(err => {
            // _startLoad 内部已处理所有已知异常，此处为最后保底
            this._log?.error(`loadScene: unhandled error for "${key}": ${err}`);
        });

        return handle;
    }

    async unloadScene(key: string): Promise<void> {
        const ctx = this._scenes.get(key);
        if (!ctx) {
            this._log?.warn(`unloadScene: "${key}" is not tracked, ignored.`);
            return;
        }
        if (ctx.state !== SceneState.Active) {
            this._log?.warn(`unloadScene: "${key}" is not Active (state=${ctx.state}), ignored.`);
            return;
        }

        ctx.state = SceneState.Unloading;
        this._log?.info(`unloadScene: "${key}" unloading...`);

        try {
            const unloadHandle = addrUnloadScene(ctx.sceneInstance);
            await $promise(unloadHandle.Task);

            // AsyncOperationStatus.Succeeded = 1 (Unity ResourceManagement)
            if (unloadHandle.Status !== 1) {
                throw new Error(`AsyncOperationStatus = ${unloadHandle.Status}`);
            }
            this._scenes.delete(key);
            this._log?.info(`unloadScene: "${key}" unloaded.`);
        } catch (e) {
            // 卸载失败时恢复状态，避免上下文进入永久 Unloading 状态
            ctx.state = SceneState.Active;
            throw new Error(`[SceneSystem] Failed to unload "${key}": ${e}`);
        }
    }

    isLoaded(key: string): boolean {
        return this._scenes.get(key)?.state === SceneState.Active;
    }

    isLoading(key: string): boolean {
        return this._pending.has(key);
    }

    getSceneState(key: string): SceneState | null {
        const ctx = this._scenes.get(key);
        if (ctx)                      return ctx.state;
        if (this._pending.has(key))   return SceneState.Loading;
        return null;
    }

    // ── 私有核心加载流程 ──────────────────────────────────────────────────────

    /**
     * 完整的异步场景加载流程：
     *   Phase 1. 前置过渡（onBeforeLoad）
     *   Phase 2. 取消检查（过渡阶段允许取消）
     *   Phase 3. Single 模式下卸载所有已追踪场景
     *   Phase 4. 发起 Addressable LoadSceneAsync（之后 onUpdate 开始轮询进度）
     *   Phase 5. 等待加载完成（await $promise）
     *   Phase 6. 取消检查（加载完成后若已取消，立即卸载并放弃激活）
     *   Phase 7. 后置过渡（onAfterLoad）
     *   Phase 8. 注册场景上下文，通知完成
     */
    private async _startLoad(
        key:        string,
        handle:     SceneProgressHandle,
        entry:      PendingEntry,
        mode:       SceneLoadMode,
        transition: ISceneTransition,
    ): Promise<void> {

        // ── Phase 1: 前置过渡 ──────────────────────────────────────────────
        try {
            await transition.onBeforeLoad();
        } catch (e) {
            this._pending.delete(key);
            const msg = `Transition.onBeforeLoad threw: ${e}`;
            this._log?.error(`loadScene "${key}": ${msg}`);
            handle._fail(SceneLoadFailReason.TransitionError, msg);
            return;
        }

        // ── Phase 2: 取消检查 ──────────────────────────────────────────────
        if (handle.isCancelled) {
            this._pending.delete(key);
            this._log?.info(`loadScene "${key}": cancelled before load started.`);
            handle._markCancelled();
            return;
        }

        // ── Phase 3: Single 模式清理已有场景 ──────────────────────────────
        if (mode === SceneLoadMode.Single) {
            await this._unloadAllTrackedScenes();
        }

        // ── Phase 4: 发起 Addressable 加载 ────────────────────────────────
        let opHandle: any;
        try {
            opHandle       = addrLoadScene(key, mode);
            entry.opHandle = opHandle; // 赋值后 onUpdate 开始轮询 PercentComplete
            this._log?.info(`loadScene "${key}": load started (mode=${mode}).`);
        } catch (e) {
            this._pending.delete(key);
            const msg = `LoadSceneAsync call failed: ${e}`;
            this._log?.error(`loadScene "${key}": ${msg}`);
            handle._fail(SceneLoadFailReason.LoadFailed, msg);
            return;
        }

        // ── Phase 5: 等待加载完成 ──────────────────────────────────────────
        try {
            await $promise(opHandle.Task);
        } catch (e) {
            this._pending.delete(key);
            const msg = `LoadSceneAsync Task faulted: ${e}`;
            this._log?.error(`loadScene "${key}": ${msg}`);
            handle._fail(SceneLoadFailReason.LoadFailed, msg);
            return;
        }

        // AsyncOperationStatus.Succeeded = 1 (Unity ResourceManagement)
        if (opHandle.Status !== 1) {
            this._pending.delete(key);
            const msg = `LoadSceneAsync failed (Status=${opHandle.Status})`;
            this._log?.error(`loadScene "${key}": ${msg}`);
            handle._fail(SceneLoadFailReason.LoadFailed, msg);
            return;
        }

        const sceneInstance: any = opHandle.Result;

        // ── Phase 6: 加载完成后的取消检查 ─────────────────────────────────
        if (handle.isCancelled) {
            this._pending.delete(key);
            this._log?.info(`loadScene "${key}": cancelled after load, unloading scene.`);
            this._safeUnloadSceneInstance(key, sceneInstance);
            handle._markCancelled();
            return;
        }

        // ── Phase 7: 后置过渡 ──────────────────────────────────────────────
        try {
            await transition.onAfterLoad();
        } catch (e) {
            // 后置过渡失败仅警告，不影响场景激活结果
            this._log?.warn(`loadScene "${key}": Transition.onAfterLoad threw: ${e}`);
        }

        // ── Phase 8: 注册场景上下文，通知完成 ─────────────────────────────
        this._pending.delete(key);

        const ctx: ISceneContext = {
            key,
            state:         SceneState.Active,
            opHandle,
            sceneInstance,
            loadMode:      mode,
        };
        this._scenes.set(key, ctx);

        this._log?.info(`loadScene "${key}": activated.`);
        handle._complete();
    }

    /**
     * 卸载所有已追踪场景，供 Single 模式加载前调用。
     * 逐个顺序卸载，单个卸载失败仅记录警告，不阻断主流程。
     */
    private async _unloadAllTrackedScenes(): Promise<void> {
        if (this._scenes.size === 0) return;

        const keys = Array.from(this._scenes.keys());
        for (const k of keys) {
            try {
                await this.unloadScene(k);
            } catch (e) {
                this._log?.warn(`_unloadAllTrackedScenes: failed to unload "${k}": ${e}`);
            }
        }
    }

    /**
     * 安全地对已加载但被取消的场景发起卸载（fire-and-forget）。
     * 不等待完成，失败时仅警告，不阻断取消流程。
     */
    private _safeUnloadSceneInstance(key: string, sceneInstance: any): void {
        try {
            addrUnloadScene(sceneInstance);
        } catch (e) {
            this._log?.warn(`_safeUnloadSceneInstance: failed for "${key}": ${e}`);
        }
    }
}
