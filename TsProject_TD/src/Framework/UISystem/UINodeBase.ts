/**
 * UINodeBase — UI 节点抽象基类
 *
 * ViewBase 和 UIComponent 的共同父类，集中管理两者共享的能力：
 *   - GO / Transform 访问（抽象 getter，由子类各自实现）
 *   - C# 配置数据读取（cfg 属性 → UIDataReader）
 *   - Unity 事件绑定自动管理（bindClick / bindEvent）
 *   - EventModule 生命周期事件（addEvent）与可见性事件（addOpenEvent）
 *   - 子 UIComponent 创建与销毁管理（createComponent / destroyComponent）
 *   - Unity 组件查找快捷工具（getComponent / findTransform / findComponent）
 *
 * ─── cfg 数据读取 ──────────────────────────────────────────────────────────────
 *
 *   子类通过重写 _getCsConfig() 返回对应的 C# 配置对象：
 *     ViewBase     → UIConfig（从 GO 上读取）
 *     UIComponent  → ComponentConfig（从 GO 上读取）
 *
 *   使用 this.cfg.xxx(key) 读取配置数据，或 cfgComp(key, csType) 获取具体组件：
 *     const speed = this.cfg.float("moveSpeed", 1.0);
 *     const btn   = this.cfgComp<Button>("btnClose", CS.UnityEngine.UI.Button);
 *
 * ─── Unity 事件绑定 ────────────────────────────────────────────────────────────
 *
 *   在 onBindEvents()（或 onCreate()）中调用，节点销毁时框架自动移除监听：
 *     this.bindClick(this.btnClose, () => this.onCloseClick());
 *     this.bindEvent(this.toggle.onValueChanged, (v: boolean) => this.onToggle(v));
 *
 * ─── EventModule 事件管理 ─────────────────────────────────────────────────────
 *
 *  【生命周期作用域（addEvent）】— 在 onCreate 中注册，onDestroy 时自动注销。
 *    适合：整个 UI 存活期间始终需要监听的事件。
 *
 *  【可见性作用域（addOpenEvent）】— 在 onRegisterEvents 中注册，onClose 后自动注销。
 *    适合：缓存模式下希望界面不可见时暂停监听以节省性能的事件。
 *
 * ─── createComponent 双模式 ───────────────────────────────────────────────────
 *
 *  【生命周期作用域（createComponent）】— 在 onCreate 中创建，onDestroy 时自动销毁。
 *    const item = await this.createComponent("ItemPrefab", parent, ItemComponent);
 *    const item = await this.createComponent("ItemPrefab", parent);   // 配置驱动
 *
 *  【可见性作用域（createOpenComponent）】— 在 onOpen 中创建，onClose 时自动销毁。
 *    适合缓存界面每次打开都需要重建的子组件（如动态列表 Item）。
 *    const item = await this.createOpenComponent("ItemPrefab", parent, ItemComponent);
 *
 * ─── createGameObject / createOpenGameObject ────────────────────────────────
 *
 *  通过资源系统实例化纯 GameObject（不绑定 UIComponent 脚本），由框架追踪生命周期。
 *  调用 destroyGameObject / destroyOpenGameObject 可提前手动释放。
 *
 *  【生命周期作用域（createGameObject）】— onCreate 中创建，onDestroy 时自动释放。
 *    this.hitEffectGO = await this.createGameObject("Prefabs/HitEffect", this.transform);
 *
 *  【可见性作用域（createOpenGameObject）】— onOpen 中创建，onClose 时自动释放。
 *    this.vfxGO = await this.createOpenGameObject("Prefabs/OpenVFX", this.transform);
 *
 * ─── 类层次结构 ──────────────────────────────────────────────────────────────
 *
 *   UINodeBase  (本文件)
 *   ├── ViewBase        — 完整 MVC View 生命周期 (onCreate/onOpen/onClose/onDestroy)
 *   └── UIComponent     — 轻量组件生命周期 (onCreate/onDestroy)
 */

import type { IResHandle } from "../ResModule/ResTypes";
import type { IEventHandle, IEventBus } from "../EventModule/EventTypes";
import { GameFramework } from "../GameFramework";
import { UIDataReader } from "./UIDataReader";
import { getUIClassCtor } from "./UIClassRegistry";

declare const CS: any;

// ─── 子节点契约接口 ────────────────────────────────────────────────────────────

/**
 * UIComponent 向 UINodeBase 暴露的最小契约接口。
 *
 * 作用：让 UINodeBase 的 createComponent 泛型约束能够引用 UIComponent 的方法，
 * 同时避免 UINodeBase ↔ UIComponent 的循环导入问题。
 * UIComponent 通过 TypeScript 结构化类型隐式满足此接口，无需显式 implements。
 */
export interface IUIChildNode {
    _setup(go: any, handle: IResHandle<any>): void;
    _onCreate(): Promise<void>;
    _onDestroy(): void;
}

// ─── UINodeBase ───────────────────────────────────────────────────────────────

export abstract class UINodeBase {

    // ── GO 访问 ───────────────────────────────────────────────────────────────

    /**
     * 节点对应的 C# GameObject。
     * ViewBase：从 IUIContext.goHandle.asset 读取。
     * UIComponent：由 _setup() 注入。
     */
    abstract get go(): any;

    /**
     * 节点对应的 C# Transform（从 go 派生，go 为 null 时返回 null）。
     */
    get transform(): any {
        const g = this.go;
        return g != null ? g.transform : null;
    }

    // ── C# 配置数据读取 ───────────────────────────────────────────────────────

    /**
     * [子类实现] 返回此节点对应的 C# 配置对象。
     *   ViewBase    → UIConfig 组件
     *   UIComponent → ComponentConfig 组件
     * 在 GO 可用之后（_setup / _onInit 之后）调用才有意义。
     */
    protected abstract _getCsConfig(): any;

    private _dataReader: UIDataReader | null = null;

    /**
     * 配置数据读取器（懒加载）。
     *
     * 在 onCreate() 及之后可安全使用。若预制体上未挂载对应配置组件，
     * cfg.isValid 为 false，所有查询返回默认值。
     *
     * @example
     *   const spd = this.cfg.float("speed", 1.0);
     *   const btn = this.cfg.obj("btnClose") as CS.UnityEngine.UI.Button;
     */
    protected get cfg(): UIDataReader {
        if (!this._dataReader) {
            this._dataReader = new UIDataReader(this._getCsConfig());
        }
        return this._dataReader;
    }

    /**
     * 从配置中以指定 key 获取 GameObject，并通过 GetComponent 返回目标 C# 类型实例。
     *
     * 适用于配置中存储 GameObject 引用、运行时需要获取特定组件的场景。
     * 若 key 对应的 GO 为空，或 GetComponent 失败，返回 null。
     *
     * @param key    配置 key（ComponentConfig / UIConfig objects 列表中的条目名）
     * @param csType 目标 C# 类型（如 CS.UnityEngine.UI.Button）
     *
     * @example
     *   const btn = this.cfgComp<Button>("btnClose", CS.UnityEngine.UI.Button);
     *   const img = this.cfgComp<Image>("iconImg",  CS.UnityEngine.UI.Image);
     */
    protected cfgComp<T>(key: string, csType: any): T | null {
        const go = this.cfg.go(key);
        if (go == null) return null;
        try {
            return go.GetComponent(csType) as T;
        } catch {
            return null;
        }
    }

    /** [框架内部] 重置数据读取器缓存（GO 重新绑定时调用，由子类在 _setup 中调用）。 */
    protected _resetDataReader(): void {
        this._dataReader = null;
    }

    // ── Unity 事件绑定管理 ────────────────────────────────────────────────────

    private _unityListeners: Array<{ event: any; fn: any }> = [];

    /**
     * 绑定 Button 点击事件，并由框架追踪生命周期。
     * 节点销毁时自动调用 RemoveListener 解绑，无需手动清理。
     *
     * @param btn      C# UnityEngine.UI.Button 实例（为 null 时静默忽略）
     * @param callback 点击回调
     *
     * @example
     *   this.bindClick(this.btnClose, () => this.close());
     *   this.bindClick(this.btnConfirm, this.onConfirm.bind(this));
     */
    protected bindClick(btn: any, callback: () => void): void {
        if (btn == null) return;
        btn.onClick.AddListener(callback);
        this._unityListeners.push({ event: btn.onClick, fn: callback });
    }

    /**
     * 绑定任意 C# UnityEvent（Toggle.onValueChanged / Slider.onValueChanged 等），
     * 并由框架追踪生命周期，节点销毁时自动解绑。
     *
     * @param unityEvent  C# UnityEvent 实例（如 toggle.onValueChanged）
     * @param callback    与该 UnityEvent 签名匹配的回调函数
     *
     * @example
     *   this.bindEvent(this.myToggle.onValueChanged, (v: boolean) => this.onToggle(v));
     *   this.bindEvent(this.mySlider.onValueChanged, (v: number)  => this.onSlide(v));
     *   this.bindEvent(this.myInput.onEndEdit,        (s: string)  => this.onInput(s));
     */
    protected bindEvent(unityEvent: any, callback: (...args: any[]) => void): void {
        if (unityEvent == null) return;
        unityEvent.AddListener(callback);
        this._unityListeners.push({ event: unityEvent, fn: callback });
    }

    /** [子类内部调用] 移除所有已追踪的 Unity 事件绑定。 */
    protected _cleanupUnityBindings(): void {
        for (const { event, fn } of this._unityListeners) {
            try { event.RemoveListener(fn); } catch { /* ignore */ }
        }
        this._unityListeners = [];
    }

    // ── EventModule 生命周期事件（addEvent） ──────────────────────────────────

    private _eventHandles: IEventHandle[] = [];

    /**
     * 向指定事件总线注册【生命周期作用域】监听器，框架自动追踪句柄。
     *
     * 生命周期：随节点创建而注册，随节点销毁（_cleanupEvents）而注销。
     * 适合在 onCreate() 中调用，整个 UI 存活期间持续监听的事件。
     *
     * @param bus      目标事件总线（全局总线或模块专属总线）
     * @param event    事件名称
     * @param callback 回调函数，this 已自动绑定到当前节点实例
     * @param options  可选配置：priority（触发优先级，数值越大越先触发）
     * @returns        事件句柄，可传入 removeEvent() 提前手动注销
     */
    protected addEvent<T extends any[] = any[]>(
        bus     : IEventBus,
        event   : string,
        callback: (...args: T) => void,
        options?: { priority?: number },
    ): IEventHandle {
        const handle = bus.on<T>(event, callback, {
            context : this,
            priority: options?.priority,
        });
        this._eventHandles.push(handle);
        return handle;
    }

    /**
     * 提前手动注销一个生命周期事件句柄并从追踪列表移除。
     */
    protected removeEvent(handle: IEventHandle): void {
        const idx = this._eventHandles.indexOf(handle);
        if (idx >= 0) this._eventHandles.splice(idx, 1);
        handle.off();
    }

    /** [子类内部调用] 注销所有生命周期作用域事件监听器。 */
    protected _cleanupEvents(): void {
        for (const h of this._eventHandles) h.off();
        this._eventHandles = [];
    }

    // ── EventModule 可见性事件（addOpenEvent） ────────────────────────────────

    private _visibilityEventHandles: IEventHandle[] = [];

    /**
     * 向指定事件总线注册【可见性作用域】监听器，框架自动追踪句柄。
     *
     * 生命周期：
     *   ViewBase    — 随每次 onOpen 前的 onRegisterEvents() 注册，
     *                 随每次 onClose 后的 onUnregisterEvents() + 框架自动注销。
     *   UIComponent — 随 onCreate 后的 onRegisterEvents() 注册，随销毁时注销。
     *
     * 与 addEvent 的区别：适合缓存模式下界面不可见时暂停监听以节省性能。
     *
     * @param bus      目标事件总线
     * @param event    事件名称
     * @param callback 回调函数
     * @param options  可选配置：priority
     * @returns        事件句柄，可传入 removeOpenEvent() 提前注销
     */
    protected addOpenEvent<T extends any[] = any[]>(
        bus     : IEventBus,
        event   : string,
        callback: (...args: T) => void,
        options?: { priority?: number },
    ): IEventHandle {
        const handle = bus.on<T>(event, callback, {
            context : this,
            priority: options?.priority,
        });
        this._visibilityEventHandles.push(handle);
        return handle;
    }

    /**
     * 提前手动注销一个可见性事件句柄并从追踪列表移除。
     */
    protected removeOpenEvent(handle: IEventHandle): void {
        const idx = this._visibilityEventHandles.indexOf(handle);
        if (idx >= 0) this._visibilityEventHandles.splice(idx, 1);
        handle.off();
    }

    /** [子类内部调用] 注销所有可见性作用域事件监听器（可安全重复调用）。 */
    protected _cleanupVisibilityEvents(): void {
        for (const h of this._visibilityEventHandles) h.off();
        this._visibilityEventHandles = [];
    }

    // ── 事件注册生命周期钩子（可选重写） ──────────────────────────────────────

    /**
     * 事件注册钩子（可选重写，默认空实现）。
     *
     * ViewBase    — 在每次 onOpen() 之前调用。
     *               在此用 addOpenEvent() 注册 EventModule 监听器，
     *               关闭时框架会自动注销，缓存界面无需手动管理。
     *
     * UIComponent — 在 onCreate() 完成后调用一次。
     *               在此集中注册组件生命周期内的事件监听，保持 onCreate 职责单一。
     *
     * @example
     *   protected override onRegisterEvents(): void {
     *       this.addOpenEvent(eventBus, "PlayerDead", this.onPlayerDead.bind(this));
     *   }
     */
    protected onRegisterEvents(): void | Promise<void> {}

    /**
     * 事件注销钩子（可选重写，默认空实现）。
     *
     * ViewBase    — 在每次 onClose() 之后调用，与 onRegisterEvents 对称。
     *               通过 addOpenEvent() 注册的事件框架已自动注销，
     *               此处可清理未通过 addOpenEvent 追踪的原始 CS 事件订阅等。
     *
     * UIComponent — 在 onDestroy() 之前调用一次，做镜像清理。
     */
    protected onUnregisterEvents(): void {}

    // ── 子组件管理 — 生命周期作用域（createComponent） ──────────────────────────

    private _children    : IUIChildNode[]    = [];
    private _childHandles: IResHandle<any>[] = [];

    // ── 子组件管理 — 可见性作用域（createOpenComponent） ─────────────────────────

    private _openChildren    : IUIChildNode[]    = [];
    private _openChildHandles: IResHandle<any>[] = [];

    // ── GameObject 管理 — 生命周期作用域（createGameObject） ─────────────────────

    private _goHandles: Map<any, IResHandle<any>> = new Map();

    // ── GameObject 管理 — 可见性作用域（createOpenGameObject） ───────────────────

    private _openGoHandles: Map<any, IResHandle<any>> = new Map();

    // ── 内部实例化辅助 ────────────────────────────────────────────────────────

    /**
     * [内部] 实例化预制体并解析 UIComponent 构造函数。
     * 若 onCreate() 抛出，立即释放 handle，异常向上传播。
     * 调用方负责将返回的 child / handle 推入对应的追踪列表。
     */
    private async _instantiateComponent<T extends IUIChildNode>(
        resKey: string,
        parent: any,
        ctor  ?: new () => T,
    ): Promise<{ child: T; handle: IResHandle<any> }> {
        const resSys = GameFramework.instance.getModule<any>("ResSystem");
        const handle = await resSys.instantiateAsync(resKey, parent) as IResHandle<any>;

        let actualCtor: new () => T;

        if (ctor) {
            actualCtor = ctor;
        } else {
            // 配置驱动：从预制体 ComponentConfig 读取 componentClassName
            const compConfig = handle.asset.GetComponent(
                CS.GameFramework.UI.ComponentConfig
            ) as any;

            if (!compConfig) {
                handle.release();
                throw new Error(
                    `[createComponent] "${resKey}" 缺少 ComponentConfig 组件。` +
                    `请挂载 ComponentConfig 并填写 componentClassName，或在调用时传入 ctor 参数。`
                );
            }

            const className = compConfig.componentClassName as string;
            if (!className) {
                handle.release();
                throw new Error(
                    `[createComponent] "${resKey}" 的 ComponentConfig.componentClassName 为空，` +
                    `请填写 TypeScript 组件类名。`
                );
            }

            const resolvedCtor = getUIClassCtor(className) as (new () => T) | undefined;

            if (!resolvedCtor) {
                handle.release();
                throw new Error(
                    `[createComponent] UIComponent 类 "${className}" 未注册。` +
                    `请在类定义上添加 @UIClass 装饰器，并确保该模块已被 import。`
                );
            }

            actualCtor = resolvedCtor;
        }

        const child = new actualCtor();
        child._setup(handle.asset, handle);

        try {
            await child._onCreate();
        } catch (e) {
            // 清理已在 _onCreate 中部分注册的事件与子资源，再释放 GO
            try { child._onDestroy(); } catch { /* ignore */ }
            handle.release();
            throw e;
        }

        return { child, handle };
    }

    // ── UIComponent 创建 / 销毁 ───────────────────────────────────────────────

    /**
     * 实例化并初始化一个 UIComponent 子节点，挂到指定父节点 Transform 下。
     *
     * 【生命周期作用域】节点销毁（onDestroy）时框架自动销毁并释放资源句柄。
     * 适合在 onCreate() 中创建的持久性子组件。
     *
     * ─── 双模式使用 ────────────────────────────────────────────────────────────
     *
     * 【显式 ctor 模式（推荐，类型推断完整）】
     *   const item = await this.createComponent("Prefabs/ItemCell", content, ItemCellComponent);
     *
     * 【配置驱动模式（无需传 ctor，由 ComponentConfig 决定脚本类）】
     *   const item = await this.createComponent("Prefabs/ItemCell", content);
     *
     * @param resKey  Addressable 资源 key（子节点预制体地址）
     * @param parent  父节点 CS.UnityEngine.Transform
     * @param ctor    UIComponent 子类构造函数（选填；省略时从 ComponentConfig 读取类名）
     * @returns       已完成 onCreate() 的子节点实例
     */
    protected async createComponent<T extends IUIChildNode>(
        resKey: string,
        parent: any,
        ctor  ?: new () => T,
    ): Promise<T> {
        const { child, handle } = await this._instantiateComponent(resKey, parent, ctor);
        this._children.push(child);
        this._childHandles.push(handle);
        return child;
    }

    /**
     * 实例化并初始化一个 UIComponent 子节点，挂到指定父节点 Transform 下。
     *
     * 【可见性作用域】界面关闭（onClose）时框架自动销毁并释放资源句柄。
     * 适合在 onOpen() 中创建的子组件（如缓存界面每次打开时动态建立的列表 Item）。
     * UIComponent 中调用时，效果等同 createComponent（组件销毁时清理）。
     *
     * @param resKey  Addressable 资源 key（子节点预制体地址）
     * @param parent  父节点 CS.UnityEngine.Transform
     * @param ctor    UIComponent 子类构造函数（选填；省略时从 ComponentConfig 读取类名）
     * @returns       已完成 onCreate() 的子节点实例
     *
     * @example
     *   protected override async onOpen(mode: UIOpenMode): Promise<void> {
     *       for (const data of this.itemList) {
     *           const item = await this.createOpenComponent("Prefabs/ItemCell", content, ItemCell);
     *           item.setData(data);
     *       }
     *   }
     */
    protected async createOpenComponent<T extends IUIChildNode>(
        resKey: string,
        parent: any,
        ctor  ?: new () => T,
    ): Promise<T> {
        const { child, handle } = await this._instantiateComponent(resKey, parent, ctor);
        this._openChildren.push(child);
        this._openChildHandles.push(handle);
        return child;
    }

    /**
     * 手动销毁并移除单个【生命周期作用域】子节点，释放其 Addressable 资源句柄。
     * 可在任意时机提前调用（例如列表数据减少时销毁多余 Item）。
     * 框架会将其从追踪列表移除，onDestroy 时不会重复销毁。
     *
     * @param child 由 createComponent 返回的子节点实例
     */
    protected destroyComponent(child: IUIChildNode): void {
        const idx = this._children.indexOf(child);
        if (idx < 0) return;
        this._children.splice(idx, 1);
        const handle = this._childHandles.splice(idx, 1)[0];
        try   { child._onDestroy(); }
        catch (e) { console.error("[UINodeBase] destroyComponent error:", e); }
        handle.release();
    }

    /**
     * 手动销毁并移除单个【可见性作用域】子节点，释放其 Addressable 资源句柄。
     * 框架会将其从追踪列表移除，onClose 时不会重复销毁。
     *
     * @param child 由 createOpenComponent 返回的子节点实例
     */
    protected destroyOpenComponent(child: IUIChildNode): void {
        const idx = this._openChildren.indexOf(child);
        if (idx < 0) return;
        this._openChildren.splice(idx, 1);
        const handle = this._openChildHandles.splice(idx, 1)[0];
        try   { child._onDestroy(); }
        catch (e) { console.error("[UINodeBase] destroyOpenComponent error:", e); }
        handle.release();
    }

    // ── GameObject 直接管理 ───────────────────────────────────────────────────

    /**
     * 通过资源系统实例化一个纯 GameObject（不绑定 UIComponent 脚本），
     * 并由框架以【生命周期作用域】追踪资源句柄。
     *
     * 节点销毁（onDestroy）时框架自动调用 handle.release() 销毁 GO 并回收内存。
     * 适合在 onCreate() 中创建的持久性 GO（粒子容器、装饰物等）。
     *
     * @param resKey  Addressable 资源 key（预制体地址）
     * @param parent  可选父节点 CS.UnityEngine.Transform；省略则置于场景根
     * @returns       实例化后的 C# GameObject
     *
     * @example
     *   this.particleGO = await this.createGameObject("Prefabs/HitEffect", this.transform);
     */
    protected async createGameObject(resKey: string, parent?: any): Promise<any> {
        const resSys = GameFramework.instance.getModule<any>("ResSystem");
        const handle = await resSys.instantiateAsync(resKey, parent) as IResHandle<any>;
        this._goHandles.set(handle.asset, handle);
        return handle.asset;
    }

    /**
     * 提前手动销毁并释放一个由 createGameObject 创建的 GO。
     * 框架会将其从追踪列表移除，onDestroy 时不会重复销毁。
     *
     * @param go  由 createGameObject 返回的 C# GameObject
     */
    protected destroyGameObject(go: any): void {
        const handle = this._goHandles.get(go);
        if (handle == null) return;
        this._goHandles.delete(go);
        handle.release();
    }

    /**
     * 通过资源系统实例化一个纯 GameObject（不绑定 UIComponent 脚本），
     * 并由框架以【可见性作用域】追踪资源句柄。
     *
     * 界面关闭（onClose）时框架自动调用 handle.release() 销毁 GO 并回收内存。
     * 适合在 onOpen() 中创建的临时 GO（开场动画特效、动态背景等）。
     * UIComponent 中调用时，效果等同 createGameObject（组件销毁时清理）。
     *
     * @param resKey  Addressable 资源 key（预制体地址）
     * @param parent  可选父节点 CS.UnityEngine.Transform；省略则置于场景根
     * @returns       实例化后的 C# GameObject
     *
     * @example
     *   this.vfxGO = await this.createOpenGameObject("Prefabs/OpenVFX", this.transform);
     */
    protected async createOpenGameObject(resKey: string, parent?: any): Promise<any> {
        const resSys = GameFramework.instance.getModule<any>("ResSystem");
        const handle = await resSys.instantiateAsync(resKey, parent) as IResHandle<any>;
        this._openGoHandles.set(handle.asset, handle);
        return handle.asset;
    }

    /**
     * 提前手动销毁并释放一个由 createOpenGameObject 创建的 GO。
     * 框架会将其从追踪列表移除，onClose 时不会重复销毁。
     *
     * @param go  由 createOpenGameObject 返回的 C# GameObject
     */
    protected destroyOpenGameObject(go: any): void {
        const handle = this._openGoHandles.get(go);
        if (handle == null) return;
        this._openGoHandles.delete(go);
        handle.release();
    }

    // ── 内部生命周期清理 ──────────────────────────────────────────────────────

    /** [子类内部调用] 递归销毁所有【生命周期作用域】子节点并释放其资源句柄。 */
    protected _cleanupComponents(): void {
        for (let i = 0; i < this._children.length; i++) {
            try   { this._children[i]._onDestroy(); }
            catch (e) { console.error("[UINodeBase] Component cleanup error:", e); }
            this._childHandles[i].release();
        }
        this._children     = [];
        this._childHandles = [];
    }

    /** [子类内部调用] 递归销毁所有【可见性作用域】子节点并释放其资源句柄（onClose 时调用）。 */
    protected _cleanupOpenComponents(): void {
        for (let i = 0; i < this._openChildren.length; i++) {
            try   { this._openChildren[i]._onDestroy(); }
            catch (e) { console.error("[UINodeBase] Open component cleanup error:", e); }
            this._openChildHandles[i].release();
        }
        this._openChildren     = [];
        this._openChildHandles = [];
    }

    /** [子类内部调用] 释放所有【生命周期作用域】GameObject 句柄（onDestroy 时调用）。 */
    protected _cleanupGoHandles(): void {
        for (const handle of this._goHandles.values()) {
            try { handle.release(); } catch { /* ignore */ }
        }
        this._goHandles.clear();
    }

    /** [子类内部调用] 释放所有【可见性作用域】GameObject 句柄（onClose 时调用）。 */
    protected _cleanupOpenGoHandles(): void {
        for (const handle of this._openGoHandles.values()) {
            try { handle.release(); } catch { /* ignore */ }
        }
        this._openGoHandles.clear();
    }

    // ── Unity 快捷工具 ────────────────────────────────────────────────────────

    /**
     * 从节点根 GameObject 获取指定 Unity 组件。
     * @example const btn = this.getComponent<Button>(CS.UnityEngine.UI.Button);
     */
    protected getComponent<T = any>(csType: any): T | null {
        const g = this.go;
        return g != null ? (g.GetComponent(csType) as T) : null;
    }

    /**
     * 按相对路径查找子 Transform（等效于 C# Transform.Find）。
     * @example const content = this.findTransform("Scroll/Viewport/Content");
     */
    protected findTransform(path: string): any | null {
        const t = this.transform;
        return t != null ? t.Find(path) : null;
    }

    /**
     * 按相对路径查找子 Transform 上的指定 Unity 组件。
     * @example const txt = this.findComponent<Text>("Title", CS.UnityEngine.UI.Text);
     */
    protected findComponent<T = any>(path: string, csType: any): T | null {
        const t = this.findTransform(path);
        return t != null ? (t.GetComponent(csType) as T) : null;
    }
}
