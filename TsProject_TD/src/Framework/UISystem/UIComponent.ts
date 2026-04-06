/**
 * UIComponent — 可复用 UI 组件基类
 *
 * 继承 UINodeBase，自动获得：
 *   Unity 事件绑定 / cfg 配置读取 / EventModule 事件管理 / 嵌套子组件管理 / Unity 快捷工具
 *
 * 适用场景：
 *   在 ViewBase（或另一个 UIComponent）内部通过 createComponent 实例化的子控件，
 *   例如列表 Item、可复用卡片、进度条等。
 *   每个组件拥有独立的生命周期与资源句柄（由父节点持有并释放）。
 *
 * ─── cfg 与 cfgComp 数据读取 ──────────────────────────────────────────────────
 *
 *   预制体根节点上需挂载 ComponentConfig，在 Inspector 中配置数据。
 *   在 onCreate() 中读取：
 *
 *     const speed = this.cfg.float("speed", 1.0);
 *     const btn   = this.cfgComp<Button>("btnOk", CS.UnityEngine.UI.Button);
 *
 * ─── 生命周期 ─────────────────────────────────────────────────────────────────
 *
 *   父节点调用 createComponent(resKey, parent[, ctor]) →
 *     _setup(go, handle)    — 注入 GO 引用（handle 由父节点持有，此处不存储）
 *     _onCreate()
 *       → onCreate()        — 获取 cfg 引用、调用 bindClick / bindEvent 绑定 Unity 事件
 *       → onRegisterEvents() — 注册 EventModule 事件监听（可选重写）
 *
 *   父节点销毁或调用 destroyComponent() →
 *     _onDestroy()
 *       → onUnregisterEvents()       — 镜像清理（可选重写）
 *       → open-scope 子组件销毁      — createOpenComponent 创建的子组件
 *       → open-scope GO 释放         — createOpenGameObject 创建的 GO
 *       → 生命周期子组件销毁          — createComponent 创建的子组件
 *       → 生命周期 GO 释放            — createGameObject 创建的 GO
 *       → Unity 事件解绑 → 可见性事件注销 → 生命周期事件注销
 *       → onDestroy()
 *     handle.release()      — GO 资源句柄由父节点在调用 _onDestroy() 后释放
 *
 * ─── 资源管理规则 ─────────────────────────────────────────────────────────────
 *
 *   当前组件自身的 GO 及资源句柄由【父节点】持有并释放，
 *   UIComponent 本身不持有也不负责释放自己的 handle。
 *
 *   通过以下 API 创建的子资源，销毁时框架自动释放，无需手动管理：
 *     createComponent(resKey, parent, ctor?)   — 创建子 UIComponent（生命周期作用域）
 *     createOpenComponent(resKey, parent, ctor?) — 创建子 UIComponent（可见性作用域，UIComponent 内等同生命周期）
 *     createGameObject(resKey, parent?)        — 创建纯 GO（生命周期作用域）
 *     createOpenGameObject(resKey, parent?)    — 创建纯 GO（可见性作用域，UIComponent 内等同生命周期）
 *   需提前销毁时，使用对应的 destroy*() 方法，框架从追踪列表移除，不会重复销毁。
 */

import type { IResHandle } from "../ResModule/ResTypes";
import { UINodeBase } from "./UINodeBase";

declare const CS: any;

export abstract class UIComponent extends UINodeBase {

    private _nodeGO: any = null;

    // ── GO 访问 ───────────────────────────────────────────────────────────────

    /**
     * 对应的 C# GameObject，由 _setup() 注入。
     * 不应在 _setup() 调用前访问。
     */
    override get go(): any { return this._nodeGO; }

    // ── C# 配置访问 ───────────────────────────────────────────────────────────

    /**
     * 返回此组件 GO 上的 C# ComponentConfig 实例。
     * UINodeBase.cfg 通过此方法获取配置对象，懒加载后缓存。
     */
    protected override _getCsConfig(): any {
        const g = this.go;
        if (g == null) return null;
        try {
            return g.GetComponent(CS.GameFramework.UI.ComponentConfig);
        } catch {
            return null;
        }
    }

    // ── 内部生命周期（由父 ViewBase / UIComponent 调用） ──────────────────────

    /**
     * [框架内部] 注入 GO 引用并重置数据读取器缓存。
     * handle 由父节点的追踪列表持有，此处仅存储 GO，不存储 handle。
     */
    _setup(go: any, _handle: IResHandle<any>): void {
        this._nodeGO = go;
        this._resetDataReader();
    }

    /**
     * [框架内部] 触发初始化流程，支持 async：
     *   1. onCreate()         — 获取组件引用、绑定 Unity 事件
     *   2. onRegisterEvents() — 注册 EventModule 事件监听（可选重写）
     */
    async _onCreate(): Promise<void> {
        await this.onCreate();
        await this.onRegisterEvents();
    }

    /**
     * [框架内部] 触发完整销毁流程：
     *   1. onUnregisterEvents()       — 可选的手动事件清理钩子
     *   2. _cleanupOpenComponents()   — 销毁所有 createOpenComponent 创建的子组件
     *   3. _cleanupOpenGoHandles()    — 释放所有 createOpenGameObject 创建的 GO
     *   4. _cleanupComponents()       — 递归销毁 createComponent 创建的子组件
     *   5. _cleanupGoHandles()        — 释放 createGameObject 创建的 GO
     *   6. _cleanupUnityBindings()    — 解绑所有已追踪的 Unity 事件（bindClick / bindEvent）
     *   7. _cleanupVisibilityEvents() — 注销所有可见性作用域事件（addOpenEvent）
     *   8. _cleanupEvents()           — 注销所有生命周期作用域事件（addEvent）
     *   9. onDestroy()
     * 调用完毕后，父节点负责 release() 当前组件的资源句柄。
     */
    _onDestroy(): void {
        this.onUnregisterEvents();
        this._cleanupOpenComponents();
        this._cleanupOpenGoHandles();
        this._cleanupComponents();
        this._cleanupGoHandles();
        this._cleanupUnityBindings();
        this._cleanupVisibilityEvents();
        this._cleanupEvents();
        this.onDestroy();
    }

    // ── 抽象生命周期（业务 UIComponent 子类必须实现） ─────────────────────────

    /**
     * 组件初始化回调，仅调用一次（GO 已挂载到父节点之后）。
     * 在此通过 cfg / cfgComp 获取 Unity 组件引用，并调用 bindClick / bindEvent 绑定事件。
     * 支持 async（可在此 await 异步资源）。
     *
     * @example
     *   protected override onCreate(): void {
     *       this.btnSelect = this.cfgComp("btnSelect", CS.UnityEngine.UI.Button);
     *       this.nameText  = this.cfgComp("nameText",  CS.UnityEngine.UI.Text);
     *       this.bindClick(this.btnSelect, () => this.onSelect());
     *   }
     */
    protected abstract onCreate(): void | Promise<void>;

    /**
     * 组件销毁回调（子组件、Unity 事件绑定和 EventModule 监听已由框架清理完毕）。
     * 仅需清理 onCreate 中手动创建的自定义资源（如 Tween 句柄等）。
     */
    protected abstract onDestroy(): void;
}
