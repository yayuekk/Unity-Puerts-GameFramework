/**
 * ResModule 类型定义
 *
 * 约定：
 *   - Addressable 加载的资源只能通过 Addressable 卸载
 *   - Resources 加载的资源只能通过 Resources 卸载
 *   - GameObject 的实例化与销毁必须使用 Addressable 接口，
 *     禁止直接调用 Object.Instantiate / Object.Destroy
 */

// ─── 加载来源 ─────────────────────────────────────────────────────────────────

export const ResLoadType = {
    /** 通过 Addressable Asset System 加载（推荐：异步、引用计数、支持热更新） */
    Addressable: "addressable",
    /** 通过 Unity Resources 文件夹加载（适合体积小、无需热更新的内置资源） */
    Resources: "resources",
} as const;

export type ResLoadType = typeof ResLoadType[keyof typeof ResLoadType];

// ─── IResHandle ───────────────────────────────────────────────────────────────

/**
 * 资源句柄接口。
 *
 * 每次成功加载或实例化操作均返回一个独立句柄：
 * - 共享资产（Sprite / Texture2D / TextAsset / AudioClip 等）：
 *   多个句柄可指向同一底层资产，通过引用计数管理卸载时机；
 *   当所有持有该资产的句柄均调用 release() 后，系统自动调用正确的卸载 API。
 * - Addressable 实例（GameObject）：
 *   每个句柄对应唯一的 GameObject 实例；调用 release() 时直接
 *   销毁 GameObject 并回收 Addressable 引用，无需引用计数。
 *
 * 使用注意：
 *   - release() 后不得再访问 asset，此时 asset 已置为 null，
 *     且底层 Unity 对象可能已被销毁/卸载。
 *   - release() 是幂等操作，重复调用安全。
 */
export interface IResHandle<T = any> {
    /** 资产唯一标识（Addressable address 或 Resources 路径） */
    readonly key: string;
    /** 加载来源 */
    readonly loadType: ResLoadType;
    /**
     * 已加载的资产对象。
     * - 资产句柄：UnityEngine.Object 子类（Sprite / Texture2D / TextAsset / AudioClip 等）
     * - 实例句柄：UnityEngine.GameObject
     * 调用 release() 后置为 null。
     */
    readonly asset: T | null;
    /** 资产是否已加载完成且句柄未被释放 */
    readonly isLoaded: boolean;
    /** 是否已调用过 release() */
    readonly isReleased: boolean;
    /**
     * 归还本句柄对资产的引用。
     * - 共享资产：引用计数 -1；归零时系统自动调用对应的卸载 API。
     * - Addressable 实例：立即调用 Addressables.ReleaseInstance(go)，GameObject 被销毁。
     * 幂等：重复调用安全，多余的调用静默忽略。
     */
    release(): void;
}

// ─── IResSystem ───────────────────────────────────────────────────────────────

export interface IResSystem {
    /**
     * 通过 Addressable key 异步加载资产（不实例化）。
     *
     * 对同一 key 并发加载时，底层仅发起一次 LoadAssetAsync 请求；
     * 后续并发调用等待同一 Promise 并共享资产，通过引用计数管理生命周期。
     * 使用完毕必须调用 handle.release() 归还引用。
     *
     * @param key  Addressable Groups 中配置的 address
     */
    loadAsync<T>(key: string): Promise<IResHandle<T>>;

    /**
     * 通过 Resources 路径加载资产（内部调用同步 Resources.Load，以 Promise 包装）。
     *
     * 同一路径多次加载共享引用，通过引用计数管理卸载时机。
     * 使用完毕必须调用 handle.release() 归还引用。
     *
     * @param path  Resources 相对路径，不含扩展名（如 "Sprites/UIAtlas"）
     */
    loadFromResourcesAsync<T>(path: string): Promise<IResHandle<T>>;

    /**
     * 通过 Addressable key 异步实例化 GameObject。
     *
     * 每次调用均产生新的独立 GameObject 实例，返回独立实例句柄。
     * 禁止直接使用 Object.Instantiate 或 Object.Destroy，须通过本接口管理。
     * 使用完毕必须调用 handle.release() 或 releaseInstance(go) 释放。
     *
     * @param key     Addressable address（对应 Prefab 资源）
     * @param parent  可选父节点 Transform（CS.UnityEngine.Transform），传 undefined 则置于场景根
     */
    instantiateAsync(key: string, parent?: any): Promise<IResHandle<any>>;

    /**
     * 通过原始 GameObject 引用释放 Addressable 实例（销毁并回收内存）。
     *
     * 适合仅持有 GameObject 引用而无句柄的场景；等效于对应句柄的 release()。
     * @param go  由 instantiateAsync 创建的 CS.UnityEngine.GameObject
     */
    releaseInstance(go: any): void;

    /**
     * 卸载所有已加载资产与存活实例，场景切换时调用以彻底清理内存。
     * 调用后可通过 loadAsync / instantiateAsync 重新加载。
     */
    releaseAll(): void;

    /** 当前缓存中共享资产的去重数量（Addressable + Resources 合计） */
    readonly loadedCount: number;

    /** 当前存活且未释放的 Addressable 实例数量 */
    readonly instanceCount: number;
}
