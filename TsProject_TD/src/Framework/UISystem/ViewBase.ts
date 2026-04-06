/**
 * ViewBase — MVC View 层基类
 *
 * 继承 UINodeBase，自动获得：
 *   Unity 事件绑定 / EventModule 事件管理 / 子 UIComponent 管理 / Unity 快捷工具
 *
 * 职责（ViewBase 自身）：
 *   - 持有并暴露 IUIContext（GO、resName、config、isVisible）
 *   - 定义 View 的完整生命周期钩子，供业务 View 子类实现
 *
 * ─── 生命周期流程 ─────────────────────────────────────────────────────────────
 *
 *   ┌─ 首次打开 ────────────────────────────────────────────────────────────────┐
 *   │  _setup(ctx) → _onInit()                                                  │
 *   │    → onCreate()          ← 获取 cfg 引用、绑定 Unity 事件（bindClick 等）  │
 *   │  → Service.onPreload(Fresh)                                                │
 *   │  → GO.SetActive(true)                                                      │
 *   │  → _onOpen(Fresh)                                                          │
 *   │    → onRegisterEvents()  ← 注册 EventModule 可见性事件（addOpenEvent）     │
 *   │    → onOpen(Fresh)       ← 完整数据初始化                                  │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ 关闭（缓存模式 isCached=true）────────────────────────────────────────────┐
 *   │  _onClose()                                                                │
 *   │    → onClose()                ← 停止动画、暂停音效等                       │
 *   │    → onUnregisterEvents()     ← 手动清理未追踪的 CS 事件订阅（可选）       │
 *   │    → _cleanupOpenComponents() ← 框架自动销毁 createOpenComponent 创建的组件│
 *   │    → _cleanupOpenGoHandles()  ← 框架自动释放 createOpenGameObject 创建的GO │
 *   │    → _cleanupVisibilityEvents() ← 框架自动注销 addOpenEvent 注册的事件     │
 *   │  → GO.SetActive(false)                                                     │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ 再次打开（从缓存恢复）────────────────────────────────────────────────────┐
 *   │  Service.onPreload(FromCache) → GO.SetActive(true)                        │
 *   │  → _onOpen(FromCache)                                                      │
 *   │    → onRegisterEvents()  ← 重新注册可见性事件                              │
 *   │    → onOpen(FromCache)   ← 仅刷新变化数据                                 │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ 销毁（非缓存关闭 / 缓存超时 / 强制销毁）──────────────────────────────────┐
 *   │  [onClose] → Service.onDestroy                                            │
 *   │  → _onDestroy()                                                            │
 *   │    → open-scope 组件/GO 销毁（兜底：防止 destroy 未经 close 的情况）       │
 *   │    → 生命周期 组件/GO 销毁 → Unity 事件解绑                                │
 *   │    → 可见性事件注销 → 生命周期事件注销                                     │
 *   │    → onDestroy()                                                           │
 *   │  → goHandle.release()                                                     │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 * ─── 事件管理规则 ─────────────────────────────────────────────────────────────
 *
 *   bindClick / bindEvent    — Unity 事件绑定，onDestroy 时统一解绑。
 *   addEvent()               — 生命周期作用域，onDestroy 时注销。
 *   addOpenEvent()           — 可见性作用域，onClose 后自动注销；适合缓存界面。
 *   onRegisterEvents()       — 每次 onOpen 前调用，集中放置 addOpenEvent 调用。
 *   onUnregisterEvents()     — 每次 onClose 后调用，镜像清理（可选重写）。
 *
 * ─── 资源管理规则 ─────────────────────────────────────────────────────────────
 *
 *   createComponent()        — 生命周期作用域子组件，onDestroy 时自动销毁。
 *   createOpenComponent()    — 可见性作用域子组件，onClose 时自动销毁；适合缓存界面。
 *   createGameObject()       — 生命周期作用域 GO，onDestroy 时自动释放。
 *   createOpenGameObject()   — 可见性作用域 GO，onClose 时自动释放；适合缓存界面。
 *   destroy*() 系列          — 提前手动释放，从追踪列表移除，不会重复销毁。
 */

import type { IViewBase, IUIContext, UIOpenMode, IUIRuntimeConfig } from "./UITypes";
import { UINodeBase } from "./UINodeBase";

declare const CS: any;

export abstract class ViewBase extends UINodeBase implements IViewBase {

    private _ctx!: IUIContext;

    // ── 只读属性 ──────────────────────────────────────────────────────────────

    /** 对应的 C# GameObject（由 UISystem 注入，销毁后 goHandle.release() 使其失效） */
    override get go(): any { return this._ctx?.goHandle?.asset ?? null; }

    /** Addressable 资源名（等于 UISystem.openUI() 传入的 name） */
    get resName(): string { return this._ctx?.name ?? ""; }

    /** 运行时配置（层级、缓存策略等），初始化后不变 */
    get config(): IUIRuntimeConfig | null { return this._ctx?.config ?? null; }

    /** 当前是否处于可见（激活）状态 */
    get isVisible(): boolean { return this._ctx?.isVisible ?? false; }

    // ── C# 配置访问 ───────────────────────────────────────────────────────────

    /**
     * 返回此 View 的 C# UIConfig 实例（挂在 GO 根节点上）。
     * UINodeBase.cfg 通过此方法获取配置对象，懒加载后缓存。
     */
    protected override _getCsConfig(): any {
        const g = this.go;
        if (g == null) return null;
        try {
            return CS.GameFramework.UI.UIRoot.GetUIConfig(g);
        } catch {
            return null;
        }
    }

    // ── 内部生命周期（由 UISystem 调用，业务代码不应直接调用） ─────────────────

    /** [框架内部] 注入上下文并重置数据读取器缓存，必须在 _onInit 之前完成。 */
    _setup(ctx: IUIContext): void {
        this._ctx = ctx;
        this._resetDataReader();
    }

    /** [框架内部] 触发 onCreate()，仅调用一次。 */
    async _onInit(): Promise<void> {
        await this.onCreate();
    }

    /**
     * [框架内部] 触发可见性事件注册与 onOpen()，每次显示时调用。
     *   1. onRegisterEvents() — 注册本次可见期间的 EventModule 监听器
     *   2. onOpen(mode)       — 完整或增量数据初始化
     */
    async _onOpen(mode: UIOpenMode): Promise<void> {
        await this.onRegisterEvents();
        await this.onOpen(mode);
    }

    /**
     * [框架内部] 触发关闭流程，每次隐藏时调用。
     *   1. onClose()                  — 业务清理（停动画、暂停音效等）
     *   2. onUnregisterEvents()       — 可选的手动事件清理钩子
     *   3. _cleanupOpenComponents()   — 框架销毁所有 createOpenComponent 创建的子组件
     *   4. _cleanupOpenGoHandles()    — 框架释放所有 createOpenGameObject 创建的 GO
     *   5. _cleanupVisibilityEvents() — 框架注销所有 addOpenEvent 注册的监听器
     */
    _onClose(): void {
        this.onClose();
        this.onUnregisterEvents();
        this._cleanupOpenComponents();
        this._cleanupOpenGoHandles();
        this._cleanupVisibilityEvents();
    }

    /**
     * [框架内部] 触发完整销毁流程：
     *   1. _cleanupOpenComponents()   — 兜底销毁可见性作用域子组件（防止 destroy 未经 close）
     *   2. _cleanupOpenGoHandles()    — 兜底释放可见性作用域 GO
     *   3. _cleanupComponents()       — 递归销毁生命周期作用域子 UIComponent 并释放资源句柄
     *   4. _cleanupGoHandles()        — 释放生命周期作用域 GameObject 资源句柄
     *   5. _cleanupUnityBindings()    — 解绑所有已追踪的 Unity 事件（bindClick / bindEvent）
     *   6. _cleanupVisibilityEvents() — 注销所有可见性作用域事件（addOpenEvent）
     *   7. _cleanupEvents()           — 注销所有生命周期作用域事件（addEvent）
     *   8. onDestroy()
     */
    _onDestroy(): void {
        this._cleanupOpenComponents();
        this._cleanupOpenGoHandles();
        this._cleanupComponents();
        this._cleanupGoHandles();
        this._cleanupUnityBindings();
        this._cleanupVisibilityEvents();
        this._cleanupEvents();
        this.onDestroy();
    }

    // ── 抽象生命周期（业务 View 子类必须实现） ───────────────────────────────

    /**
     * 初始化回调，仅调用一次（GO 已挂载到层级节点之后）。
     * 在此通过 cfg / cfgComp 获取 Unity 组件引用，并调用 bindClick / bindEvent 绑定事件。
     * 支持 async（可在此 await 异步资源加载，如图集预加载）。
     *
     * @example
     *   protected override async onCreate(): Promise<void> {
     *       this.btnClose   = this.cfgComp("btnClose",  CS.UnityEngine.UI.Button);
     *       this.titleText  = this.cfgComp("title",     CS.UnityEngine.UI.Text);
     *       this.bindClick(this.btnClose, () => this.close());
     *   }
     */
    protected abstract onCreate(): void | Promise<void>;

    /**
     * 每次界面变为可见时调用（onRegisterEvents 完成之后）。
     *
     * @param mode
     *   UIOpenMode.Fresh     — 首次打开或缓存超时后重建，需完整初始化显示数据。
     *   UIOpenMode.FromCache — 从缓存恢复，MVC 状态保留，只需刷新变化的数据。
     */
    protected abstract onOpen(mode: UIOpenMode): void | Promise<void>;

    /**
     * 每次界面变为不可见时调用（onUnregisterEvents 之前）。
     * 可在此停止动画、暂停音效等。
     * 缓存模式下不会销毁 MVC，此处不应释放重要状态数据。
     */
    protected abstract onClose(): void;

    /**
     * 界面永久销毁时调用（子组件、Unity 事件绑定和 EventModule 监听已由框架清理完毕）。
     * 仅需清理 onCreate/onOpen 中手动创建的自定义资源（如 Tween 句柄等）。
     */
    protected abstract onDestroy(): void;
}
