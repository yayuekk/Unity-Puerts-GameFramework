/**
 * PoolSystem 类型定义
 *
 * 设计原则：
 *   - 仅包含对外暴露的接口与枚举，与内部实现完全解耦
 *   - 工厂接口（IPoolItemFactory）定义对象的完整生命周期钩子
 *   - IPool 为单类型池的读写接口；IPoolSystem 为系统级管理接口
 */

// ─── 工厂接口 ──────────────────────────────────────────────────────────────────

/**
 * 对象池项工厂接口。
 * 实现此接口以定义池对象的创建、激活、回收与永久销毁行为。
 *
 * 使用示例（普通对象）：
 *   class BulletFactory implements IPoolItemFactory<Bullet> {
 *     create()           { return new Bullet(); }
 *     onGet(b: Bullet)   { b.reset(); }
 *     onReturn(b: Bullet){ b.cleanup(); }
 *     onDestroy()        {}
 *   }
 */
export interface IPoolItemFactory<T> {
    /** 创建一个新的池项实例 */
    create(): T;
    /** 对象从池中取出时调用（如激活、数据重置） */
    onGet(item: T): void;
    /** 对象归还池中时调用（如停用、清理引用） */
    onReturn(item: T): void;
    /** 对象被永久销毁时调用（如 Object.Destroy、资源卸载） */
    onDestroy(item: T): void;
    /**
     * 工厂自身的清理回调（可选）。
     * 在对象池被彻底销毁（destroy()）时由 ObjectPool 自动调用一次。
     * 典型用途：释放工厂持有的 IResHandle，使 ResSystem 能够卸载对应资产。
     */
    dispose?(): void;
}

// ─── 对象池配置 ────────────────────────────────────────────────────────────────

/**
 * createGoPoolAsync 专用配置类型。
 * 与 IPoolConfig 相同，但省略 factory（由系统内部通过 ResSystem 自动构建）。
 */
export type IGoPoolConfig = Omit<IPoolConfig<any>, "factory">;

/** 创建对象池的配置选项 */
export interface IPoolConfig<T> {
    /** 对象池唯一名称，通常使用类型名（如 "Bullet"）或 Addressable key */
    readonly name: string;
    /** 工厂实例，负责创建、激活、回收和永久销毁池对象 */
    readonly factory: IPoolItemFactory<T>;
    /**
     * 初始预热数量。
     * 注册后通过 warmup() 分帧完成，不占用注册帧时间。
     */
    readonly initialCapacity?: number;
    /**
     * 池容量上限（0 或省略表示不限）。
     * 超出上限时归还的对象直接调用 onDestroy 销毁，不再入池。
     */
    readonly maxCapacity?: number;
    /**
     * 空闲自动销毁延迟（秒）。
     * 引用计数归零（无对象在外部使用）且连续空闲超过此值后，对象池自动清除。
     * 传 0 禁用自动销毁，默认 60 秒。
     */
    readonly autoDestroyDelay?: number;
}

// ─── 状态快照 ──────────────────────────────────────────────────────────────────

/** 对象池当前状态快照（只读） */
export interface IPoolStats {
    /** 对象池名称 */
    readonly name: string;
    /** 当前闲置（可立即取出）对象数 */
    readonly available: number;
    /** 当前使用中（已 get 未 return）对象数 */
    readonly inUse: number;
    /** 池内对象总数（available + inUse） */
    readonly total: number;
    /** 引用计数（= inUse，归零后开始空闲计时） */
    readonly refCount: number;
    /** 是否正在执行分帧预热 */
    readonly isWarming: boolean;
    /** 引用计数归零后已持续空闲的时间（秒） */
    readonly idleSeconds: number;
}

// ─── 预热句柄 ──────────────────────────────────────────────────────────────────

/**
 * 分帧预热任务句柄。
 * 由 PoolSystem.warmup() 返回，可监控进度或中止任务。
 * 中止后已完成的对象保留在池中，不会回滚。
 */
export interface IWarmupHandle {
    /** 关联的对象池名称 */
    readonly poolName: string;
    /** 计划预热的总数量 */
    readonly totalCount: number;
    /** 已完成预热的数量 */
    readonly completedCount: number;
    /** 是否全部完成（完成或取消均为 true） */
    readonly isDone: boolean;
    /** 是否已取消 */
    readonly isCancelled: boolean;
    /** 取消此预热任务 */
    cancel(): void;
}

// ─── 单池接口 ──────────────────────────────────────────────────────────────────

/** 单类型对象池接口 */
export interface IPool<T = any> {
    /** 对象池唯一名称 */
    readonly name: string;
    /** 当前闲置对象数 */
    readonly available: number;
    /** 当前使用中对象数 */
    readonly inUse: number;
    /** 总对象数 */
    readonly total: number;
    /** 引用计数（= inUse） */
    readonly refCount: number;
    /** 对象池是否仍然存活（未被清除） */
    readonly isAlive: boolean;
    /**
     * 从池中取出一个对象。
     * 池为空时自动调用工厂的 create() 创建新实例。
     */
    get(): T;
    /** 将对象归还池中 */
    return(item: T): void;
    /**
     * 同步预热指定数量（立即批量创建，不分帧）。
     * 受 maxCapacity 限制，超出上限的部分会被跳过。
     * @returns 实际创建的对象数量（≤ count）
     */
    warmupSync(count: number): number;
    /** 销毁池内所有闲置对象（使用中对象不受影响），池本身保持存活 */
    clear(): void;
    /** 获取当前状态快照 */
    getStats(): IPoolStats;
}

// ─── 系统接口 ──────────────────────────────────────────────────────────────────

/**
 * PoolSystem 对外接口（面向接口编程，便于 Mock / 替换实现）。
 * 通过 framework.getModule<IPoolSystem>("PoolSystem") 获取。
 */
export interface IPoolSystem {
    /**
     * 创建一个具名对象池并注册到系统。
     * 若同名对象池已存在则直接返回现有池（配置不覆盖），并输出警告日志。
     * 若配置了 initialCapacity，会自动提交分帧预热任务。
     */
    createPool<T>(config: IPoolConfig<T>): IPool<T>;

    /** 对象池是否已注册（且存活） */
    hasPool(name: string): boolean;

    /** 按名称获取对象池，不存在返回 undefined */
    getPool<T>(name: string): IPool<T> | undefined;

    /**
     * 从指定对象池取出一个对象。
     * 若对象池尚未创建，使用提供的工厂自动创建后再取出。
     *
     * @param name    对象池名称（通常为类型名）
     * @param factory 池不存在时用于自动创建的工厂实例
     */
    get<T>(name: string, factory: IPoolItemFactory<T>): T;

    /**
     * 将对象归还到指定名称的对象池。
     * - 若 name 省略，则以 `item.constructor.name` 作为池名。
     * - 若对应对象池不存在，优先调用 factory.onDestroy 销毁对象；
     *   无工厂时尝试 Unity Object.Destroy（仅对 CS 对象有效）。
     *
     * @param item    要归还的对象
     * @param name    目标对象池名称（可省略）
     * @param factory 池不存在时用于销毁的工厂（可省略）
     */
    return<T>(item: T, name?: string, factory?: IPoolItemFactory<T>): void;

    /**
     * 异步创建 GameObject 对象池（推荐用法）。
     *
     * 内部流程：
     *   1. 通过 ResSystem.loadAsync(key) 加载 Prefab 资产（引用计数 +1）
     *   2. 以加载得到的 IResHandle + poolName 构建 ResGameObjectFactory：
     *      · 自动创建名称 = config.name 的池根节点 GameObject
     *      · 检测 Prefab 是否为 UI（RectTransform），并对池根节点做相应处理
     *   3. 注册对象池；若配置了 initialCapacity 则自动提交分帧预热
     *
     * 资产卸载时机：
     *   对象池被销毁（clearPool / clearAllPools / 空闲超时）时，
     *   ResGameObjectFactory.dispose() 自动调用 handle.release() 并销毁池根节点，
     *   ResSystem 引用计数归零后自动卸载 Prefab 资产。
     *
     * 池根节点持久化（DontDestroyOnLoad）：
     *   池根节点始终置于 DontDestroyOnLoad 场景，不随关卡切换被销毁。
     *   · UI 对象池：闲置对象 SetActive(false)，在 DontDestroyOnLoad 中无需 Canvas 父节点；
     *     取出时（get）通过 activeParent 自动移至正确的 Canvas。
     *   · 3D 对象池：同样驻留 DontDestroyOnLoad，取出时移至场景根或 activeParent。
     *   poolRootParent 参数已弃用，传入值将被忽略。
     *
     * 依赖：
     *   PoolSystem 必须在 ResSystem **之后**注册，否则抛出错误。
     *
     * @param key             Addressable address（对应 Prefab 资源）
     * @param config          对象池配置（无需传 factory）
     * @param poolRootParent  已弃用，传入值将被忽略（池根节点统一在 DontDestroyOnLoad）
     * @param activeParent    get() 取出对象时的目标父节点；省略则置于场景根
     */
    createGoPoolAsync(
        key:            string,
        config:         IGoPoolConfig,
        poolRootParent?: any,
        activeParent?:   any,
    ): Promise<IPool<any>>;

    /**
     * 向指定对象池提交分帧预热任务。
     * 预热进度由 ComputingSystem.cpuLoad 动态调配：
     *   cpuLoad ≥ 1.0 → 本帧跳过 | ≥ 0.8 → 1 个/帧 | ≥ 0.6 → 2 个/帧
     *   ≥ 0.4 → 4 个/帧 | < 0.4 → 8 个/帧
     *
     * @param name  对象池名称（必须已注册）
     * @param count 计划预热的数量
     * @returns     可用于监控进度或取消的句柄
     */
    warmup(name: string, count: number): IWarmupHandle;

    /** 清除并销毁指定名称的对象池（含池内所有闲置对象） */
    clearPool(name: string): void;

    /** 清除并销毁所有已注册的对象池 */
    clearAllPools(): void;

    /** 获取所有对象池的状态快照列表 */
    getAllStats(): IPoolStats[];
}
