/**
 * ResSystem — 资源加载系统核心
 *
 * 职责：
 *   - 统一管理 Addressable 和 Resources 两套加载通道的完整生命周期
 *   - 对共享资产实施引用计数，引用归零时自动调用正确的卸载 API 防止内存泄漏
 *   - 对 Addressable 实例提供统一的创建与销毁入口，确保销毁路径唯一
 *
 * 并发安全：
 *   同一 Addressable key 的并发加载请求只发起一次底层 LoadAssetAsync，
 *   后续请求等待同一 Promise（基于 JavaScript 单线程事件循环保证）。
 *
 * 使用约定（在整个项目范围内强制执行）：
 *   1. 加载任意资产后持有返回的 IResHandle，用完调用 handle.release()
 *   2. GameObject 实例化必须通过 instantiateAsync，禁止 Object.Instantiate
 *   3. GameObject 销毁必须通过 handle.release() 或 releaseInstance()，禁止 Object.Destroy
 *   4. 场景卸载前调用 releaseAll() 彻底清理内存
 *
 * 依赖：
 *   - puerts $promise：将 C# System.Threading.Tasks.Task 转为 JS Promise
 *   - C# 桥接：通过 require("csharp") 获取，与 index.cts 一致，避免全局 CS 未注入
 *   - UnityEngine.AddressableAssets.Addressables：Addressable 加载与卸载
 *   - UnityEngine.Resources：Resources 文件夹同步加载与卸载
 */

import { $promise } from "puerts";

// PuerTS C# 桥接：优先使用 csharp 模块（与 index.cts 一致），避免依赖未注入的全局 CS
const _CS: any = (function (): any {
    try {
        return require("csharp");
    } catch {
        return typeof globalThis !== "undefined" ? (globalThis as any).CS : undefined;
    }
})();
if (typeof _CS === "undefined") {
    throw new Error("[ResSystem] C# bridge not available: neither require('csharp') nor global CS.");
}

import type { GameFramework, IModule } from "../GameFramework";
import type { LogSystem } from "../LogModule";
import type { ILogChannelHandle } from "../LogModule";
import { ResLoadType } from "./ResTypes";
import type { IResHandle, IResSystem } from "./ResTypes";
import { ResHandle } from "./ResHandle";
import type { IResController } from "./ResHandle";

// ─── PuerTS ↔ Unity C# 桥接辅助 ──────────────────────────────────────────────
// 将所有 CS namespace 调用集中于此，与业务逻辑彻底解耦，
// 方便在不同 Puerts 版本或 Unity 版本下统一调整。

/** AddressablesBridge.LoadAssetAsync(key) → AsyncOperationHandle（因 Puerts 未生成 Addressables.LoadAssetAsync 绑定，走 C# 桥接） */
function addrLoad(key: string): any {
    return _CS.AddressablesBridge.LoadAssetAsync(key);
}

/**
 * AddressablesBridge.InstantiateAsync(key [, parent]) → AsyncOperationHandle<GameObject>
 * parent 为 CS.UnityEngine.Transform，不传则实例置于场景根。
 */
function addrInstantiate(key: string, parent?: any): any {
    return parent != null
        ? _CS.AddressablesBridge.InstantiateAsync(key, parent)
        : _CS.AddressablesBridge.InstantiateAsync(key);
}

/** AddressablesBridge.Release(operationHandle) — 卸载非实例资产或释放失败的 AsyncOperationHandle */
function addrRelease(opHandle: any): void {
    _CS.AddressablesBridge.Release(opHandle);
}

/** AddressablesBridge.ReleaseInstance(go) — 销毁 GameObject 并释放 Addressable 引用 */
function addrReleaseInstance(go: any): void {
    _CS.AddressablesBridge.ReleaseInstance(go);
}

/** Resources.Load(path) → UnityEngine.Object（同步） */
function resLoad(path: string): any {
    return _CS.UnityEngine.Resources.Load(path);
}

/** Resources.UnloadAsset(asset) — 卸载非实例资产 */
function resUnload(asset: any): void {
    _CS.UnityEngine.Resources.UnloadAsset(asset);
}

// ─── 内部数据结构 ─────────────────────────────────────────────────────────────

/** Addressable 共享资产缓存条目 */
interface AddrAssetEntry {
    readonly key: string;
    /** 已加载的 Unity 资产对象；加载中或失败时为 null */
    asset: any | null;
    /** 存储 AsyncOperationHandle，用于后续 Addressables.Release()；加载完成前为 null */
    opHandle: any | null;
    /** 当前持有该资产的句柄数量；归零时自动卸载 */
    refCount: number;
    /**
     * 加载进行中的 Promise；加载完成后置 null。
     * 并发加载同一 key 时，后续请求 await 此 Promise 而非重复发起请求。
     */
    pending: Promise<void> | null;
    /**
     * 由 releaseAll() 设置为 true，通知所有正在等待此条目的并发调用者终止并抛出。
     * 用于区分"主动取消"与"加载失败"两种中止原因。
     */
    cancelled: boolean;
}

/** Resources 共享资产缓存条目 */
interface ResAssetEntry {
    readonly path: string;
    asset: any;
    refCount: number;
}

// ─── ResSystem ────────────────────────────────────────────────────────────────

export class ResSystem implements IModule, IResSystem, IResController {

    readonly moduleName = "ResSystem";

    private readonly _addrAssets = new Map<string, AddrAssetEntry>();
    private readonly _resAssets  = new Map<string, ResAssetEntry>();
    /**
     * 存活实例映射：key = GameObject 引用，value = Addressable address。
     * 用于 releaseAll() 遍历销毁，以及 releaseInstance() 有效性校验。
     */
    private readonly _instances  = new Map<any, string>();

    private _log?: ILogChannelHandle;

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(fw: GameFramework): void {
        const logSys = fw.tryGetModule<LogSystem>("LogSystem");
        this._log = logSys?.registerChannel("res", "ResSystem");
        this._log?.info("ResSystem initialized.");
    }

    onShutdown(): void {
        this.releaseAll();
        this._log?.info("ResSystem shutdown complete.");
    }

    // ── IResSystem — 加载接口 ─────────────────────────────────────────────────

    async loadAsync<T>(key: string): Promise<IResHandle<T>> {
        const existing = this._addrAssets.get(key);

        if (existing) {
            // 若同一 key 正在加载中，等待其完成再共享结果
            if (existing.pending !== null) {
                await existing.pending;
                // 等待期间 releaseAll() 可能已清空 map 并标记 cancelled
                if (existing.cancelled) {
                    throw new Error(`[ResSystem] Load of "${key}" was cancelled by releaseAll.`);
                }
            }
            if (existing.asset === null) {
                throw new Error(`[ResSystem] Addressable "${key}" failed to load.`);
            }
            existing.refCount++;
            this._log?.debug(`loadAsync: cache hit "${key}" (refCount=${existing.refCount})`);
            return new ResHandle<T>(this, "asset", key, ResLoadType.Addressable, existing.asset as T);
        }

        // 首次加载：注册条目后立即发起异步请求
        const entry: AddrAssetEntry = {
            key, asset: null, opHandle: null, refCount: 0, pending: null, cancelled: false,
        };
        this._addrAssets.set(key, entry);

        const loadPromise = this._execAddrLoad(key, entry);
        entry.pending = loadPromise;
        try {
            await loadPromise;
        } finally {
            entry.pending = null;
        }

        // releaseAll() 在等待期间被调用：条目已从 map 移除并标记取消。
        // 若加载恰好成功，此处负责释放 opHandle，防止 Unity 资源泄漏。
        if (entry.cancelled) {
            if (entry.opHandle !== null) {
                try { addrRelease(entry.opHandle); } catch { /* 仅做最大努力释放 */ }
            }
            throw new Error(`[ResSystem] Load of "${key}" was cancelled by releaseAll.`);
        }

        if (entry.asset === null) {
            this._addrAssets.delete(key);
            throw new Error(`[ResSystem] Failed to load Addressable: "${key}"`);
        }

        entry.refCount = 1;
        this._log?.debug(`loadAsync: loaded "${key}"`);
        return new ResHandle<T>(this, "asset", key, ResLoadType.Addressable, entry.asset as T);
    }

    async loadFromResourcesAsync<T>(path: string): Promise<IResHandle<T>> {
        const existing = this._resAssets.get(path);
        if (existing) {
            existing.refCount++;
            this._log?.debug(`loadFromResourcesAsync: cache hit "${path}" (refCount=${existing.refCount})`);
            return new ResHandle<T>(this, "asset", path, ResLoadType.Resources, existing.asset as T);
        }

        const asset = resLoad(path);
        if (asset == null) {
            throw new Error(`[ResSystem] Resources.Load returned null for path "${path}"`);
        }

        const entry: ResAssetEntry = { path, asset, refCount: 1 };
        this._resAssets.set(path, entry);
        this._log?.debug(`loadFromResourcesAsync: loaded "${path}"`);
        return new ResHandle<T>(this, "asset", path, ResLoadType.Resources, asset as T);
    }

    async instantiateAsync(key: string, parent?: any): Promise<IResHandle<any>> {
        // opHandle 声明在 try 外，确保失败路径中 catch 块可访问并正确释放
        let opHandle: any = null;
        let go: any = null;
        try {
            opHandle = addrInstantiate(key, parent);
            await $promise(opHandle.Task);

            // AsyncOperationStatus.Succeeded = 1 (Unity ResourceManagement)
            if (opHandle.Status !== 1) {
                throw new Error(`AsyncOperationStatus = ${opHandle.Status}`);
            }
            go = opHandle.Result;
        } catch (e) {
            // go 未被赋值说明实例化未成功，需手动释放 opHandle 防止 Unity 资源泄漏
            if (opHandle !== null && go === null) {
                try { addrRelease(opHandle); } catch { /* 仅做最大努力释放 */ }
            }
            throw new Error(`[ResSystem] Failed to instantiate Addressable "${key}": ${e}`);
        }

        if (!go) {
            throw new Error(`[ResSystem] instantiateAsync returned null GameObject for key "${key}"`);
        }

        this._instances.set(go, key);
        this._log?.debug(`instantiateAsync: "${key}" (instances=${this._instances.size})`);
        return new ResHandle<any>(this, "instance", key, ResLoadType.Addressable, go);
    }

    // ── IResSystem — 释放接口 ─────────────────────────────────────────────────

    releaseInstance(go: any): void {
        if (!this._instances.has(go)) {
            this._log?.warn(`releaseInstance: unknown GameObject, ignored.`);
            return;
        }
        const key = this._instances.get(go)!;
        this._instances.delete(go);
        try {
            addrReleaseInstance(go);
            this._log?.debug(`releaseInstance: "${key}" destroyed.`);
        } catch (e) {
            this._log?.error(`releaseInstance: error releasing "${key}": ${e}`);
        }
    }

    releaseAll(): void {
        // 销毁全部存活 Addressable 实例
        for (const [go, key] of this._instances) {
            try {
                addrReleaseInstance(go);
            } catch (e) {
                this._log?.error(`releaseAll: error destroying instance "${key}": ${e}`);
            }
        }
        this._instances.clear();

        // 卸载全部缓存的 Addressable 资产。
        // 对仍在加载中的条目（opHandle 尚为 null）：设置 cancelled 标记，通知等待方终止。
        // 加载完成后由 loadAsync 检测 cancelled 标记并负责释放 opHandle。
        for (const entry of this._addrAssets.values()) {
            if (entry.pending !== null) {
                entry.cancelled = true;
            }
            if (entry.opHandle !== null) {
                try {
                    addrRelease(entry.opHandle);
                } catch (e) {
                    this._log?.error(`releaseAll: error releasing Addressable "${entry.key}": ${e}`);
                }
            }
        }
        this._addrAssets.clear();

        // 卸载全部缓存的 Resources 资产
        for (const entry of this._resAssets.values()) {
            try {
                resUnload(entry.asset);
            } catch (e) {
                this._log?.error(`releaseAll: error unloading Resource "${entry.path}": ${e}`);
            }
        }
        this._resAssets.clear();

        this._log?.info(`releaseAll: all assets and instances released.`);
    }

    // ── IResSystem — 属性 ─────────────────────────────────────────────────────

    /** 已完成加载的共享资产去重数量（不含加载中的 pending 条目） */
    get loadedCount(): number {
        let count = this._resAssets.size;
        for (const entry of this._addrAssets.values()) {
            if (entry.asset !== null) count++;
        }
        return count;
    }

    get instanceCount(): number {
        return this._instances.size;
    }

    // ── IResController（供 ResHandle 回调）────────────────────────────────────

    onAssetHandleRelease(key: string, loadType: ResLoadType): void {
        if (loadType === ResLoadType.Addressable) {
            this._releaseAddrAsset(key);
        } else {
            this._releaseResAsset(key);
        }
    }

    onInstanceHandleRelease(go: any): void {
        this.releaseInstance(go);
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    /**
     * 执行 Addressable 异步加载并将结果写入 entry。
     * 失败时 entry.asset / entry.opHandle 保持 null，由调用方检查并上抛错误。
     * 此函数内部捕获所有异常并确保 opHandle 不泄漏。
     */
    private async _execAddrLoad(key: string, entry: AddrAssetEntry): Promise<void> {
        // opHandle 声明在 try 外，确保失败路径中 catch 块可访问并正确释放
        let opHandle: any = null;
        try {
            opHandle = addrLoad(key);
            await $promise(opHandle.Task);

            if (opHandle.Status !== 1 /* AsyncOperationStatus.Succeeded */) {
                throw new Error(`AsyncOperationStatus = ${opHandle.Status}`);
            }
            entry.opHandle = opHandle;
            entry.asset    = opHandle.Result;
        } catch (e) {
            this._log?.error(`_execAddrLoad: failed to load "${key}": ${e}`);
            // entry.opHandle 未被赋值说明加载失败，需手动释放 opHandle 防止 Unity 资源泄漏
            if (opHandle !== null && entry.opHandle === null) {
                try { addrRelease(opHandle); } catch { /* 仅做最大努力释放 */ }
            }
        }
    }

    private _releaseAddrAsset(key: string): void {
        const entry = this._addrAssets.get(key);
        if (!entry) return;

        entry.refCount--;
        this._log?.debug(`releaseAddrAsset: "${key}" refCount=${entry.refCount}`);

        if (entry.refCount <= 0) {
            if (entry.opHandle !== null) {
                try {
                    addrRelease(entry.opHandle);
                } catch (e) {
                    this._log?.error(`releaseAddrAsset: error releasing "${key}": ${e}`);
                }
            }
            this._addrAssets.delete(key);
            this._log?.debug(`releaseAddrAsset: "${key}" unloaded.`);
        }
    }

    private _releaseResAsset(path: string): void {
        const entry = this._resAssets.get(path);
        if (!entry) return;

        entry.refCount--;
        this._log?.debug(`releaseResAsset: "${path}" refCount=${entry.refCount}`);

        if (entry.refCount <= 0) {
            try {
                resUnload(entry.asset);
            } catch (e) {
                this._log?.error(`releaseResAsset: error unloading "${path}": ${e}`);
            }
            this._resAssets.delete(path);
            this._log?.debug(`releaseResAsset: "${path}" unloaded.`);
        }
    }
}
