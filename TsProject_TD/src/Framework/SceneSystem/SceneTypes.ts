/**
 * SceneSystem 类型定义
 *
 * 约定：
 *   - 所有场景加载/卸载必须通过 SceneSystem 接口进行，禁止直接调用
 *     SceneManager.LoadScene / Addressables.LoadSceneAsync
 *   - Single 模式加载时，系统会自动卸载所有 Additive 场景
 *   - 每次 loadScene 调用立即返回 ISceneProgressHandle，加载在后台进行
 */

// ─── 加载模式 ─────────────────────────────────────────────────────────────────

/**
 * 场景加载模式，数值与 Unity LoadSceneMode 枚举保持一致，可直接传递给 C# 桥接层。
 *   - Single   = 0：卸载所有已加载场景后加载新场景（默认）
 *   - Additive = 1：叠加加载，不卸载现有场景
 */
export const SceneLoadMode = {
    Single:   0,
    Additive: 1,
} as const;
export type SceneLoadMode = typeof SceneLoadMode[keyof typeof SceneLoadMode];

// ─── 场景状态 ─────────────────────────────────────────────────────────────────

export const SceneState = {
    /** 正在通过 Addressable 异步加载 */
    Loading:   "loading",
    /** 已激活，当前场景栈中存在 */
    Active:    "active",
    /** 正在卸载 */
    Unloading: "unloading",
} as const;
export type SceneState = typeof SceneState[keyof typeof SceneState];

// ─── 加载失败原因 ──────────────────────────────────────────────────────────────

export const SceneLoadFailReason = {
    /** Addressable 资产加载失败 */
    LoadFailed:      "loadFailed",
    /** 相同 key 正在加载中，重复请求被拒绝 */
    AlreadyLoading:  "alreadyLoading",
    /** 操作被外部调用 cancel() 取消 */
    Cancelled:       "cancelled",
    /** 过渡动画执行时发生异常 */
    TransitionError: "transitionError",
} as const;
export type SceneLoadFailReason = typeof SceneLoadFailReason[keyof typeof SceneLoadFailReason];

// ─── ISceneProgressHandle ─────────────────────────────────────────────────────

/**
 * 场景加载进度句柄。
 *
 * - 通过 `loadScene()` 立即返回，无需 await。
 * - 使用链式 `onProgress / onComplete / onError` 注册回调。
 * - 调用 `cancel()` 可在过渡动画阶段取消；资产加载开始后取消无效（会等待加载完成后放弃激活）。
 */
export interface ISceneProgressHandle {
    /** 目标场景的 Addressable key */
    readonly key: string;
    /** 当前加载进度，范围 [0, 1] */
    readonly progress: number;
    /** 加载是否已完成（成功或失败） */
    readonly isDone: boolean;
    /** 是否已被取消 */
    readonly isCancelled: boolean;
    /** 若加载失败，此处保存错误信息；否则为 null */
    readonly error: string | null;
    /**
     * 注册进度回调，每帧在进度变化时调用（含最终 1.0）。
     * 若注册时加载已完成，回调立即触发一次。
     */
    onProgress(cb: (progress: number) => void): this;
    /**
     * 注册完成回调，场景激活并完成过渡后触发。
     * 若注册时已完成，回调立即触发。
     */
    onComplete(cb: () => void): this;
    /**
     * 注册错误回调。
     * 若注册时已失败，回调立即触发。
     */
    onError(cb: (reason: SceneLoadFailReason, message: string) => void): this;
    /**
     * 请求取消本次加载。
     * - 过渡动画阶段：立即取消，不发起 Addressable 加载。
     * - 资产加载阶段：等待加载完成后，场景不会被激活，随即卸载。
     */
    cancel(): void;
}

// ─── ISceneLoadOptions ────────────────────────────────────────────────────────

export interface ISceneLoadOptions {
    /** 加载模式，默认 Single */
    mode?: SceneLoadMode;
    /**
     * 场景过渡策略。
     * - 在 Addressable 加载前执行 `onBeforeLoad`（如淡出）
     * - 在场景激活后执行 `onAfterLoad`（如淡入）
     * - 不传则使用系统默认过渡（空过渡，立即切换）
     */
    transition?: ISceneTransition;
}

// ─── ISceneTransition ─────────────────────────────────────────────────────────

/**
 * 场景过渡策略接口（策略模式）。
 *
 * 实现者负责管理过渡 UI 的显示与隐藏（如加载屏幕、淡入淡出）。
 * 两个方法均为 async，框架 await 执行，保证时序正确。
 */
export interface ISceneTransition {
    /**
     * 场景加载开始前执行（如淡出当前场景、显示 Loading 界面）。
     * 抛出异常将导致本次加载以 TransitionError 失败。
     */
    onBeforeLoad(): Promise<void>;
    /**
     * 新场景激活后执行（如淡入新场景、隐藏 Loading 界面）。
     * 抛出异常仅打印警告，不影响场景激活结果。
     */
    onAfterLoad(): Promise<void>;
}

// ─── ISceneContext (framework-internal) ──────────────────────────────────────

/**
 * 场景运行时上下文，由 SceneSystem 内部维护，不对外暴露。
 * @internal
 */
export interface ISceneContext {
    readonly key: string;
    state: SceneState;
    /** Addressable AsyncOperationHandle<SceneInstance>，用于后续 UnloadSceneAsync */
    opHandle: any;
    /** 加载完成后的 SceneInstance；加载中为 null */
    sceneInstance: any | null;
    /** 加载模式，Single 场景切换时需要知道哪些是 Additive 的来卸载 */
    loadMode: SceneLoadMode;
}

// ─── ISceneSystem ─────────────────────────────────────────────────────────────

export interface ISceneSystem {
    /**
     * 异步加载场景，立即返回进度句柄。
     *
     * 若目标 key 已在加载中，返回现有句柄（不重复发起加载）。
     * Single 模式下会先卸载所有 Additive 场景后再开始加载。
     *
     * @param key      Addressable Groups 中配置的场景 address
     * @param options  加载选项（模式、过渡策略等）
     */
    loadScene(key: string, options?: ISceneLoadOptions): ISceneProgressHandle;

    /**
     * 卸载指定 Additive 场景。
     * - 场景必须处于 Active 状态才能卸载。
     * - 内部调用 Addressables.UnloadSceneAsync，完成后释放 Addressable 引用。
     *
     * @param key  与加载时使用的 Addressable address 保持一致
     */
    unloadScene(key: string): Promise<void>;

    /** 场景是否已加载并处于 Active 状态 */
    isLoaded(key: string): boolean;

    /** 场景是否正在加载中 */
    isLoading(key: string): boolean;

    /** 获取场景当前状态，未追踪的场景返回 null */
    getSceneState(key: string): SceneState | null;

    /** 当前默认过渡策略（可在运行时替换） */
    defaultTransition: ISceneTransition;
}
