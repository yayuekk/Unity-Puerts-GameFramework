/**
 * StateBase<TOwner> — 状态基类
 *
 * 所有业务状态类应继承此类，并按需重写生命周期钩子。
 *
 * ─── 生命周期顺序 ─────────────────────────────────────────────────────────────
 *
 *   onInit()           — 首次实例化时调用，仅一次
 *                        在此进行一次性初始化（如缓存 owner 中的组件引用）
 *   ↓
 *   onEnter(prev)      — 每次进入此状态时调用
 *                        prev 为上一个状态；从初始状态进入时为 null
 *   ↓
 *   onUpdate(dt)       — 每帧调用（需宿主每帧调用 machine.update(dt)）
 *                        处理逐帧逻辑，切换条件满足时调用 changeTo()
 *   ↓
 *   onLeave(next)      — 每次离开此状态时调用
 *                        next 为即将进入的状态；可在此停止本状态的持续行为
 *   ↓
 *   onDestroy()        — 状态机销毁时调用（仅一次）
 *                        释放本状态持有的自定义资源
 *
 * ─── 状态切换方式 ─────────────────────────────────────────────────────────────
 *
 *   方式 A（推荐，在状态内部切换）：
 *     this.changeTo(TargetState)
 *
 *   方式 B（通过状态机管理器切换）：
 *     this.machine.changeTo(TargetState)
 *
 * ─── 访问宿主与状态机 ─────────────────────────────────────────────────────────
 *
 *   this.owner   — 宿主对象（创建状态机时传入的 this）
 *   this.machine — 状态机管理器（IStateMachine<TOwner> 接口）
 *
 * ─── 使用示例 ─────────────────────────────────────────────────────────────────
 *
 * ```ts
 * class IdleState extends StateBase<Player> {
 *
 *     protected onInit(): void {
 *         // 一次性初始化，this.owner 已可访问
 *     }
 *
 *     protected onEnter(prev: IStateBase | null): void {
 *         this.owner.playAnimation("idle");
 *     }
 *
 *     protected onUpdate(dt: number): void {
 *         if (this.owner.hasInput) {
 *             this.changeTo(RunState);
 *         }
 *     }
 *
 *     protected onLeave(next: IStateBase): void {
 *         this.owner.stopAnimation();
 *     }
 * }
 * ```
 */

import type {
    IState,
    IStateBase,
    IStateMachine,
    StateConstructor,
} from "./StateMachineTypes";

export abstract class StateBase<TOwner> implements IState<TOwner> {

    private _owner!       : TOwner;
    private _machine!     : IStateMachine<TOwner>;
    private _initialized  : boolean = false;

    // ── 只读属性（子类通过 protected getter 访问）────────────────────────────

    /**
     * 状态名称，默认返回类名。
     * 可在子类中 override 返回自定义名称（如多语言 key 或配置 ID）。
     */
    get stateName(): string {
        return (this.constructor as { name: string }).name;
    }

    /** 状态机宿主对象（在 onInit 之前由框架注入） */
    protected get owner(): TOwner {
        return this._owner;
    }

    /**
     * 状态机管理器引用（IStateMachine<TOwner> 接口，不依赖具体实现类）。
     * 可通过 this.machine.changeTo() 从外部触发转换，
     * 也可通过 this.machine.isInState() 查询其他状态。
     */
    protected get machine(): IStateMachine<TOwner> {
        return this._machine;
    }

    // ── 内部生命周期（由 StateMachine 调用，业务代码不应直接调用）────────────

    /** [框架内部] 注入宿主与状态机引用，在 _onInit 之前完成。 */
    _setup(owner: TOwner, machine: IStateMachine<TOwner>): void {
        this._owner   = owner;
        this._machine = machine;
    }

    /** [框架内部] 首次创建时触发 onInit，保证幂等。 */
    _onInit(): void {
        if (this._initialized) return;
        this._initialized = true;
        this.onInit();
    }

    /** [框架内部] 触发 onEnter。 */
    _onEnter(prev: IStateBase | null): void {
        this.onEnter(prev);
    }

    /** [框架内部] 触发 onUpdate。 */
    _onUpdate(dt: number): void {
        this.onUpdate(dt);
    }

    /** [框架内部] 触发 onLeave。 */
    _onLeave(next: IStateBase): void {
        this.onLeave(next);
    }

    /** [框架内部] 触发 onDestroy。 */
    _onDestroy(): void {
        this.onDestroy();
    }

    // ── 便捷方法 ─────────────────────────────────────────────────────────────

    /**
     * 切换到目标状态（等同于 this.machine.changeTo(StateClass)）。
     *
     * 可在 onEnter / onUpdate / onLeave 任意生命周期中安全调用：
     *   - 在 onEnter / onLeave 中调用时，转换请求会被排队，
     *     在当前转换流程完成后自动执行（避免重入）。
     *   - 在 onUpdate 中调用时，立即执行转换。
     *
     * @returns true = 已执行或已排队；false = 被守卫阻止或状态机未启动
     */
    protected changeTo<T extends StateBase<TOwner>>(
        StateClass: StateConstructor<TOwner, T>,
    ): boolean {
        return this._machine.changeTo(StateClass);
    }

    // ── 生命周期钩子（子类按需重写，均为可选）────────────────────────────────

    /**
     * 首次创建时调用（仅一次）。
     * 适合缓存 owner 中的组件引用、订阅全局事件等一次性操作。
     */
    protected onInit(): void {}

    /**
     * 每次进入此状态时调用。
     * @param prev 上一个状态；从初始状态进入时为 null
     */
    protected onEnter(prev: IStateBase | null): void {}

    /**
     * 每帧调用，由宿主的 Update 驱动（需每帧调用 machine.update(dt)）。
     * @param dt deltaTime（秒）
     */
    protected onUpdate(dt: number): void {}

    /**
     * 每次离开此状态时调用。
     * 可在此停止本状态持续的动画、计时器等行为。
     * @param next 即将进入的状态
     */
    protected onLeave(next: IStateBase): void {}

    /**
     * 状态机销毁时调用（仅一次）。
     * 释放本状态持有的自定义资源（如事件句柄、Tween 等）。
     */
    protected onDestroy(): void {}
}
