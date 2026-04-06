/**
 * PoolSystem — 对象池系统核心模块
 *
 * 职责：
 *   - 管理所有具名对象池的注册、查询、获取、归还与清除
 *   - 集成 ComputingSystem：每帧读取 cpuLoad 驱动分帧预热调度器
 *   - 集成 ResSystem：通过 createGoPoolAsync 统一管理 Prefab 资产生命周期
 *   - 通过空闲计时器自动清除长期不使用（引用计数归零）的对象池
 *
 * 关键行为：
 *   - get()              池不存在时自动创建（需传入工厂）
 *   - return()           池不存在时直接销毁对象（factory.onDestroy 或 Object.Destroy）
 *   - createGoPoolAsync  加载 Prefab → 建池 → 分帧预热，池销毁时自动卸载资产
 *   - 引用计数归零 + 持续空闲 autoDestroyDelay 秒 → 池被自动销毁（可配置）
 *
 * 注册示例（src/index.cts，注意 ResSystem 须先于 PoolSystem 注册）：
 *   framework
 *     .registerModule(new ResSystem())
 *     .registerModule(new PoolSystem());
 *
 * 获取示例：
 *   const pool = framework.getModule<IPoolSystem>("PoolSystem");
 *   // 异步创建 GameObject 池（推荐）
 *   const goPool = await pool.createGoPoolAsync("Prefabs/Bullet", { name: "BulletGO" });
 *   // 普通对象
 *   const bullet = pool.get("Bullet", bulletFactory);
 *   pool.return(bullet, "Bullet");
 */

import type { GameFramework, IModule }  from "../GameFramework";
import type { LogSystem }               from "../LogModule";
import type { ILogChannelHandle }       from "../LogModule";
import type { IComputingSystem }        from "../CPUAndGPUComputing";
import { ComputingSystem }              from "../CPUAndGPUComputing";
import type { IResSystem }              from "../ResModule";
import { ResSystem }                    from "../ResModule";
import { ResGameObjectFactory }         from "./PoolFactories";
import { ObjectPool }                   from "./ObjectPool";
import { PoolWarmupScheduler }          from "./PoolWarmup";
import type {
    IPoolItemFactory,
    IPoolConfig,
    IGoPoolConfig,
    IPoolStats,
    IWarmupHandle,
    IPool,
    IPoolSystem,
} from "./PoolTypes";

// PuerTS C# 桥接：与 ResSystem 一致，不依赖可能未注入的全局 CS
const _CS: any = (function (): any {
    try {
        return require("csharp");
    } catch {
        return typeof globalThis !== "undefined" ? (globalThis as any).CS : undefined;
    }
})();

// ─── PoolSystem ───────────────────────────────────────────────────────────────

export class PoolSystem implements IModule, IPoolSystem {

    readonly moduleName = "PoolSystem";

    private readonly _pools:     Map<string, ObjectPool<any>> = new Map();
    private readonly _scheduler: PoolWarmupScheduler          = new PoolWarmupScheduler();

    private _computing?: IComputingSystem;
    private _resSys?:    IResSystem;
    private _log?:       ILogChannelHandle;

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(fw: GameFramework): void {
        const logSys = fw.tryGetModule<LogSystem>("LogSystem");
        this._log     = logSys?.registerChannel("pool", "PoolSystem");
        this._computing = fw.tryGetModule<ComputingSystem>("ComputingSystem");
        this._resSys    = fw.tryGetModule<ResSystem>("ResSystem");

        if (!this._computing) {
            this._log?.warn(
                "ComputingSystem not found. Warmup will use default budget (cpuLoad = 0)."
            );
        }
        if (!this._resSys) {
            this._log?.warn(
                "ResSystem not found. createGoPoolAsync() will throw if called."
            );
        }
        this._log?.info("PoolSystem initialized.");
    }

    onUpdate(dt: number): void {
        const cpuLoad = this._computing?.cpuLoad ?? 0;

        // 分帧预热
        this._scheduler.update(cpuLoad);

        // 空闲自动销毁检测（先收集，再删除，避免迭代中修改 Map）
        let toDestroy: string[] | null = null;
        for (const [name, pool] of this._pools) {
            if (pool.updateIdleTimer(dt)) {
                if (toDestroy === null) toDestroy = [];
                toDestroy.push(name);
            }
        }
        if (toDestroy) {
            for (const name of toDestroy) {
                this._destroyPool(name, "idle-timeout");
            }
        }
    }

    onShutdown(): void {
        this._scheduler.cancelAll();
        this.clearAllPools();
        this._log?.info("PoolSystem shutdown.");
    }

    // ── IPoolSystem — 池管理 ──────────────────────────────────────────────────

    createPool<T>(config: IPoolConfig<T>): IPool<T> {
        const existing = this._pools.get(config.name);
        if (existing) {
            this._log?.warn(
                `createPool: pool "${config.name}" already exists, returning existing.`
            );
            return existing as IPool<T>;
        }

        const pool = new ObjectPool<T>(config);
        this._pools.set(config.name, pool);
        this._log?.info(
            `createPool: "${config.name}" created` +
            ` (maxCap=${config.maxCapacity ?? 0}` +
            `, autoDestroy=${config.autoDestroyDelay ?? 60}s).`
        );

        if (config.initialCapacity && config.initialCapacity > 0) {
            this._scheduler.schedule(pool, config.initialCapacity);
            this._log?.debug(
                `createPool: queued warmup ×${config.initialCapacity} for "${config.name}".`
            );
        }

        return pool;
    }

    hasPool(name: string): boolean {
        return this._pools.has(name);
    }

    getPool<T>(name: string): IPool<T> | undefined {
        return this._pools.get(name) as IPool<T> | undefined;
    }

    async createGoPoolAsync(
        key:             string,
        config:          IGoPoolConfig,
        poolRootParent?: any,
        activeParent?:   any,
    ): Promise<IPool<any>> {
        if (!this._resSys) {
            throw new Error(
                "[PoolSystem] createGoPoolAsync: ResSystem is not available. " +
                "Register ResSystem before PoolSystem."
            );
        }

        // 加载前先检查：避免同步重入时的重复创建
        const preExisting = this._pools.get(config.name);
        if (preExisting) {
            this._log?.warn(
                `createGoPoolAsync: pool "${config.name}" already exists, returning existing.`
            );
            return preExisting;
        }

        this._log?.debug(`createGoPoolAsync: loading prefab "${key}" for pool "${config.name}".`);

        const handle = await this._resSys.loadAsync<any>(key);
        this._log?.info(
            `createGoPoolAsync: asset loaded key="${key}", isLoaded=${!!handle?.isLoaded}, hasAsset=${handle?.asset != null}.`
        );

        // await 期间可能有另一个同名 createGoPoolAsync 完成了创建（并发竞态），
        // 此时必须释放本次加载的 handle，否则引用计数永远无法归零。
        const postExisting = this._pools.get(config.name);
        if (postExisting) {
            this._log?.warn(
                `createGoPoolAsync: pool "${config.name}" was created concurrently. ` +
                `Releasing duplicate handle for key="${key}".`
            );
            handle.release();
            return postExisting;
        }

        // poolRootParent 已弃用：池根节点统一在 DontDestroyOnLoad，此参数仅保留以兼容旧调用签名
        const factory = new ResGameObjectFactory(handle, config.name, poolRootParent, activeParent);
        const pool    = this.createPool({ ...config, factory });
        // 立即执行一档预热，避免首帧 get() 时池仍为空、场景中看不到预热对象
        this._scheduler.update(0);
        this._log?.info(
            `createGoPoolAsync: pool "${config.name}" ready (key="${key}"). available=${pool.available}, total=${pool.total}.`
        );
        return pool;
    }

    // ── IPoolSystem — 对象操作 ────────────────────────────────────────────────

    get<T>(name: string, factory: IPoolItemFactory<T>): T {
        let pool = this._pools.get(name) as ObjectPool<T> | undefined;

        if (!pool) {
            this._log?.debug(`get: pool "${name}" not found, auto-creating.`);
            pool = new ObjectPool<T>({ name, factory });
            this._pools.set(name, pool);
        }

        return pool.get();
    }

    return<T>(item: T, name?: string, factory?: IPoolItemFactory<T>): void {
        // 若未指定池名，以对象构造函数名兜底
        const poolName = name
            ?? (item != null ? (item as any).constructor?.name : undefined)
            ?? "unknown";

        const pool = this._pools.get(poolName) as ObjectPool<T> | undefined;

        if (pool) {
            pool.return(item);
            this._log?.debug(`return: "${poolName}" ← item returned.`);
        } else {
            this._log?.warn(
                `return: pool "${poolName}" not found. Destroying item.`
            );
            this._tryDestroyItem(item, factory);
        }
    }

    // ── IPoolSystem — 预热 ────────────────────────────────────────────────────

    warmup(name: string, count: number): IWarmupHandle {
        const pool = this._pools.get(name);
        if (!pool) {
            throw new Error(
                `[PoolSystem] warmup: pool "${name}" does not exist. ` +
                `Call createPool() first.`
            );
        }
        if (count <= 0) {
            throw new RangeError(
                `[PoolSystem] warmup: count must be > 0, got ${count}.`
            );
        }

        const handle = this._scheduler.schedule(pool, count);
        this._log?.debug(`warmup: queued ×${count} for "${name}".`);
        return handle;
    }

    // ── IPoolSystem — 清除 ────────────────────────────────────────────────────

    clearPool(name: string): void {
        if (!this._pools.has(name)) {
            this._log?.warn(`clearPool: pool "${name}" not found, ignored.`);
            return;
        }
        this._destroyPool(name, "manual");
    }

    clearAllPools(): void {
        for (const name of Array.from(this._pools.keys())) {
            this._destroyPool(name, "manual");
        }
        this._log?.info("clearAllPools: all pools cleared.");
    }

    // ── IPoolSystem — 统计 ────────────────────────────────────────────────────

    getAllStats(): IPoolStats[] {
        const stats: IPoolStats[] = [];
        for (const pool of this._pools.values()) {
            const s = pool.getStats();
            stats.push({
                ...s,
                isWarming: this._scheduler.isPoolWarming(pool.name),
            });
        }
        return stats;
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    /**
     * 统一销毁流程：
     *   1. 调用 pool.destroy()（清空闲置对象并标记死亡）
     *   2. 从注册表中移除
     */
    private _destroyPool(name: string, reason: string): void {
        const pool = this._pools.get(name);
        if (!pool) return;

        pool.destroy();
        this._pools.delete(name);
        this._log?.info(`pool "${name}" destroyed (reason: ${reason}).`);
    }

    /**
     * 在无对应对象池时尝试销毁游离对象。
     *
     * 优先级：
     *   1. 调用提供的 factory.onDestroy(item)
     *   2. 无工厂时，若对象为 CS Unity Object（判断 GetType 方法），调用 Object.Destroy
     *   3. 否则仅丢弃引用，由 JS GC 回收
     */
    private _tryDestroyItem<T>(item: T, factory?: IPoolItemFactory<T>): void {
        if (factory) {
            try {
                factory.onDestroy(item);
            } catch (e) {
                this._log?.error(`_tryDestroyItem: factory.onDestroy threw: ${e}`);
            }
            return;
        }

        if (item != null && typeof (item as any).GetType === "function") {
            try {
                _CS.UnityEngine.Object.Destroy(item as any);
            } catch (e) {
                this._log?.error(`_tryDestroyItem: Object.Destroy threw: ${e}`);
            }
        }
        // 普通 JS 对象交由 GC，此处无需操作
    }
}
