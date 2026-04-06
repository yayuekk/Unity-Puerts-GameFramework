/**
 * UITypes — UI 系统全局类型定义
 *
 * 设计原则：
 *   - 仅包含接口、枚举与常量，不含任何实现逻辑
 *   - 所有 UI 子模块（ViewBase / ModelBase / ServiceBase / UIComponent / UISystem）
 *     均依赖此文件的接口编程，实现之间无直接耦合
 */

import type { IResHandle } from "../ResModule/ResTypes";

// ─── UI 层级 ───────────────────────────────────────────────────────────────────

/**
 * UI 层级枚举，与 C# UILayer 枚举值保持严格对应（整数 0-4）。
 * 层级越高，视觉上越靠前，并通过 Blocker 屏蔽下层输入。
 */
export const UILayer = {
    Bottom : 0,   // 底层 —— 地图、背景 HUD
    Normal : 1,   // 普通层 —— 主界面、功能界面
    Queue  : 2,   // 队列层 —— 公告、通知
    Pop    : 3,   // 弹窗层 —— 对话框、确认框
    Top    : 4,   // 顶层 —— 全局 Loading、错误提示
} as const;
export type UILayer = typeof UILayer[keyof typeof UILayer];

// ─── 打开模式 ──────────────────────────────────────────────────────────────────

/**
 * UI 打开模式，在 ViewBase.onOpen() 中作为参数传入，
 * 供业务代码区分"首次打开/重建"与"从缓存恢复"两种场景。
 */
export const UIOpenMode = {
    /** 首次打开，或缓存超时销毁后重新打开 */
    Fresh     : "fresh",
    /** 从隐藏的缓存中恢复（MVC 状态保留，只需刷新显示数据） */
    FromCache : "fromCache",
} as const;
export type UIOpenMode = typeof UIOpenMode[keyof typeof UIOpenMode];

// ─── 运行时配置（从 C# UIConfig 读取） ────────────────────────────────────────

/**
 * UI 运行时配置，由 UISystem 从 C# UIConfig 组件读取后构建。
 * 只读，生命周期内不变。
 */
export interface IUIRuntimeConfig {
    readonly layer              : UILayer;
    readonly isCached           : boolean;
    /** 缓存超时秒数；0 = 永不超时（isCached=false 时忽略） */
    readonly cacheTimeoutSeconds: number;
    readonly viewClassName      : string;
    readonly modelClassName     : string;
    readonly serviceClassName   : string;
}

// ─── UI 运行时上下文 ───────────────────────────────────────────────────────────

/**
 * IUIContext — UI 实例在运行时的完整上下文。
 * UISystem 内部创建并持有，通过 _setup() 注入给 View / Model / Service。
 *
 * 注意：view / model / service 在 _setup() 注入时已是循环引用，
 *       这在 JavaScript 中完全合法，不影响 GC。
 */
export interface IUIContext {
    /** Addressable 资源名，也是此 UI 的全局唯一标识 */
    readonly name      : string;
    readonly config    : IUIRuntimeConfig;
    readonly goHandle  : IResHandle<any>;
    readonly view      : IViewBase | null;
    readonly model     : IModelBase | null;
    readonly service   : IServiceBase | null;
    /** 被隐藏时的时间戳（ms）；0 = 当前处于显示状态或从未被隐藏 */
    hideTimestamp      : number;
    /** 当前是否处于可见（激活）状态 */
    isVisible          : boolean;
}

// ─── 打开失败原因 ──────────────────────────────────────────────────────────────

/**
 * UI 打开失败原因枚举。
 *   PreloadFailed  — onPreload() 抛出了异常（网络错误、超时等）
 *   PreloadAborted — onPreload() 返回了 false（业务层主动中止）
 */
export const UIOpenFailReason = {
    PreloadFailed  : "preloadFailed",
    PreloadAborted : "preloadAborted",
} as const;
export type UIOpenFailReason = typeof UIOpenFailReason[keyof typeof UIOpenFailReason];

/**
 * openUI 打开失败回调类型。
 * @param name   UI 资源名
 * @param reason 失败原因
 * @param error  若 onPreload() 抛出异常，此处传入该异常；主动中止时为 undefined
 */
export type UIOpenFailedCallback = (
    name  : string,
    reason: UIOpenFailReason,
    error?: Error,
) => void;

// ─── 构造函数类型 ──────────────────────────────────────────────────────────────

export type ViewConstructor      = new () => IViewBase;
export type ModelConstructor     = new () => IModelBase;
export type ServiceConstructor   = new () => IServiceBase;

/**
 * TS 类构造函数类型，用于 @UIClass 装饰器和 UINodeBase.createComponent() 的类型约束。
 * 统一描述 View / Model / Service / UIComponent 子类的构造函数形态。
 * 泛型 T 默认为 any，避免 UITypes ↔ UINodeBase 循环导入。
 */
export type ClassConstructor<T = any> = new () => T;

// ─── 基础接口约定 ──────────────────────────────────────────────────────────────

/**
 * IViewBase — View 层对外暴露给 UISystem 的最小接口。
 * 业务 View 继承 ViewBase 抽象类，而非直接实现此接口。
 *
 * 所有 _ 前缀方法为内部调用约定，业务代码不应直接调用。
 */
export interface IViewBase {
    /** View 对应的 GameObject（C# 对象） */
    readonly go: any;
    /** 注入上下文（在 new 之后、_onInit 之前调用） */
    _setup(ctx: IUIContext): void;
    /** 初始化，对应 onCreate()，仅调用一次 */
    _onInit(): void | Promise<void>;
    /** 每次显示时调用，对应 onOpen() */
    _onOpen(mode: UIOpenMode): void | Promise<void>;
    /** 每次隐藏时调用，对应 onClose() */
    _onClose(): void;
    /** 永久销毁时调用，对应 onDestroy() */
    _onDestroy(): void;
}

/**
 * IModelBase — Model 层对外暴露给 UISystem 的最小接口。
 */
export interface IModelBase {
    _setup(ctx: IUIContext): void;
    _onInit(): void;
    _onDestroy(): void;
}

/**
 * IServiceBase — Service 层对外暴露给 UISystem 的最小接口。
 * Service 持有 View 和 Model 引用，作为两者之间的协调者。
 */
export interface IServiceBase {
    _setup(ctx: IUIContext, view: IViewBase, model: IModelBase | null): void;
    _onInit(): void;
    /**
     * [框架内部] 预加载入口，在 onInit 之后、onOpen 之前调用。
     * 返回 true 继续打开，false / throw 则中止并触发 onFailed 回调。
     */
    _onPreload(mode: UIOpenMode): Promise<boolean>;
    _onDestroy(): void;
}
