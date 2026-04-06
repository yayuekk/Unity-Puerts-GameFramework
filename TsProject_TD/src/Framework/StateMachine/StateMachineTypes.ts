/**
 * StateMachineTypes — 状态机系统公共类型定义
 *
 * 设计原则：
 *   - 仅包含接口、类型别名与常量，不含任何实现逻辑
 *   - StateBase / StateMachine 均依赖此文件的接口编程，实现之间无直接耦合
 *   - 泛型参数 TOwner 代表持有状态机的宿主类型，贯穿整个模块
 *
 * 生命周期流程（StateMachine 驱动）：
 *
 *   ┌─ 首次进入（setInitialState，机器未运行）──────────────────────────────┐
 *   │  _getOrCreate(): new → _setup → _onInit() → 写入缓存                 │
 *   │  → notifyListeners(null, state) → _onEnter(null)                     │
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ 状态切换（changeTo → _runTransitionLoop 迭代引擎）──────────────────┐
 *   │  guard check → _getOrCreate(next) → prevState._onLeave(next)         │
 *   │  → [_current = next] → notifyListeners(prev, next)                   │
 *   │  → nextState._onEnter(prev) → 消费 _pendingState（循环下一轮）        │
 *   │  （pending 转换在新 _current 上重新检查守卫）                         │
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ 每帧驱动 ────────────────────────────────────────────────────────────┐
 *   │  machine.update(dt) → currentState._onUpdate(dt)                     │
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ 销毁（destroy）──────────────────────────────────────────────────────┐
 *   │  所有缓存状态调用 _onDestroy() → 清空缓存、守卫、监听器               │
 *   └───────────────────────────────────────────────────────────────────────┘
 */

// ─── 状态基础接口 ──────────────────────────────────────────────────────────────

/**
 * IStateBase — 状态的最小公共接口（不含泛型）。
 * 用于在 onEnter / onLeave 参数和 currentState / previousState 属性中
 * 无需关心 TOwner 的场景下引用状态对象。
 */
export interface IStateBase {
    /** 状态名称（默认使用类名，可在子类中重写）*/
    readonly stateName: string;
}

/**
 * IState<TOwner> — 框架内部完整状态接口。
 * 定义 StateMachine 与 StateBase 之间的生命周期调度约定。
 * 所有 _ 前缀方法为框架内部调用约定，业务代码不应直接调用。
 */
export interface IState<TOwner> extends IStateBase {
    /** [框架内部] 注入宿主对象和状态机引用，在 _onInit 之前完成 */
    _setup(owner: TOwner, machine: IStateMachine<TOwner>): void;

    /** [框架内部] 首次实例化时调用（仅一次），用于一次性初始化 */
    _onInit(): void;

    /** [框架内部] 每次进入此状态时调用 */
    _onEnter(prev: IStateBase | null): void;

    /** [框架内部] 每帧调用，由 machine.update(dt) 驱动 */
    _onUpdate(dt: number): void;

    /** [框架内部] 每次离开此状态时调用 */
    _onLeave(next: IStateBase): void;

    /** [框架内部] 状态机销毁时调用，清理本状态持有的资源 */
    _onDestroy(): void;
}

// ─── 构造函数类型 ──────────────────────────────────────────────────────────────

/**
 * 状态类构造函数类型。
 * 约束：必须为无参构造（状态机负责创建实例并注入依赖）。
 *
 * 泛型说明：
 *   TOwner — 宿主类型
 *   T      — 具体状态类型（extends IState<TOwner>），默认为 IState<TOwner>
 */
export type StateConstructor<TOwner, T extends IState<TOwner> = IState<TOwner>> = new () => T;

// ─── 守卫类型 ─────────────────────────────────────────────────────────────────

/**
 * 转换守卫函数类型。
 *
 * 在 changeTo 执行前调用，返回 false 则阻止本次转换。
 * 同一 (from, to) 对可注册多个守卫，所有守卫均通过才允许转换。
 *
 * @param owner   宿主对象（可访问宿主的运行时数据）
 * @param from    当前状态（初始转换时为 null）
 * @param toName  目标状态的名称字符串（用于日志或通用逻辑）
 *
 * @example
 * fsm.addGuard(IdleState, RunState, (owner) => owner.stamina > 0);
 */
export type TransitionGuard<TOwner> = (
    owner  : TOwner,
    from   : IStateBase | null,
    toName : string,
) => boolean;

// ─── 转换回调类型 ──────────────────────────────────────────────────────────────

/**
 * 状态转换完成回调类型。
 * 在 onLeave 之后、onEnter 之前触发，此时 machine.currentState 已切换到 to。
 *
 * @param from   上一个状态；初始进入时为 null
 * @param to     即将激活的状态
 * @param owner  宿主对象
 */
export type TransitionCallback<TOwner> = (
    from  : IStateBase | null,
    to    : IStateBase,
    owner : TOwner,
) => void;

// ─── 转换监听句柄 ──────────────────────────────────────────────────────────────

/**
 * ITransitionHandle — onTransition() 注册后返回的句柄。
 * 调用 off() 可随时注销该监听器。
 */
export interface ITransitionHandle {
    /** 句柄唯一 ID */
    readonly id     : number;
    /** 是否仍处于活跃状态（未注销） */
    readonly isActive : boolean;
    /** 注销该转换监听 */
    off(): void;
}

// ─── 状态机接口 ────────────────────────────────────────────────────────────────

/**
 * IStateMachine<TOwner> — 状态机管理器完整接口。
 *
 * 设计要点：
 *   - StateBase 通过此接口引用状态机，不依赖具体实现类 StateMachine，
 *     便于测试时注入 Mock 实现。
 *   - 所有状态转换最终通过 changeTo 统一入口，保证守卫和监听器的一致触发。
 *
 * 典型使用模式：
 * ```ts
 * class Enemy {
 *     readonly fsm = new StateMachine(this);
 *
 *     onStart()              { this.fsm.setInitialState(IdleState); }
 *     onUpdate(dt: number)   { this.fsm.update(dt); }
 *     onDestroy()            { this.fsm.destroy(); }
 * }
 * ```
 */
export interface IStateMachine<TOwner> {
    // ── 只读状态 ────────────────────────────────────────────────────────────

    /** 状态机宿主对象 */
    readonly owner            : TOwner;

    /** 当前活跃状态；setInitialState 调用前为 null */
    readonly currentState     : IStateBase | null;

    /** 上一个状态；从未切换过时为 null */
    readonly previousState    : IStateBase | null;

    /** 是否已通过 setInitialState 启动 */
    readonly isRunning        : boolean;

    /** 当前已缓存的状态实例数量（性能监控用） */
    readonly cachedStateCount : number;

    // ── 核心控制 ────────────────────────────────────────────────────────────

    /**
     * 设置并进入初始状态，启动状态机。
     * - 若状态机尚未运行，则以此为首个状态（onEnter 的 prev 为 null）。
     * - 若状态机已在运行，则等同于 changeTo（触发完整转换流程）。
     */
    setInitialState<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): void;

    /**
     * 切换到目标状态。
     *
     * 执行流程：
     *   1. 检查守卫（addGuard 注册的条件），失败则返回 false
     *   2. 若当前正在转换中，将请求放入待处理槽，本轮循环结束后自动执行；
     *      此时守卫会以最新的 currentState 重新检查
     *   3. 依次调用 prevState.onLeave → notifyListeners → nextState.onEnter
     *
     * 注意：在同一转换流程中多次调用 changeTo 时，只有最后一次有效
     * （前者会被后者覆盖），建议使用守卫或在 onUpdate 中控制切换时机。
     *
     * @returns
     *   true  — 转换已执行或已加入待处理队列
     *   false — 被守卫阻止、或状态机尚未启动
     */
    changeTo<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): boolean;

    /**
     * 驱动当前状态的 onUpdate 生命周期。
     * 必须在宿主类的 Update / onTick 中每帧调用。
     *
     * @param dt deltaTime（秒）
     */
    update(dt: number): void;

    /**
     * 销毁状态机，对所有已缓存状态调用 onDestroy，清空内部数据。
     * 销毁后不可再使用，需重新创建实例。
     */
    destroy(): void;

    // ── 查询 ────────────────────────────────────────────────────────────────

    /**
     * 判断当前状态是否为指定类型。
     * 使用 instanceof 检测，支持继承。
     */
    isInState<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): boolean;

    /**
     * 获取指定类型的状态实例。
     * 若实例尚不存在则会立即创建并调用 _setup / _onInit（预热）。
     * 适合在切换前提前预热目标状态资源。
     */
    getState<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): T;

    // ── 守卫 ────────────────────────────────────────────────────────────────

    /**
     * 为指定状态对 (from → to) 添加转换守卫。
     * 同一对可注册多个守卫，均通过才允许转换（AND 关系）。
     *
     * @example
     * fsm.addGuard(IdleState, AttackState, (owner) => owner.mp >= 10);
     */
    addGuard<TFrom extends IState<TOwner>, TTo extends IState<TOwner>>(
        from  : StateConstructor<TOwner, TFrom>,
        to    : StateConstructor<TOwner, TTo>,
        guard : TransitionGuard<TOwner>,
    ): void;

    /**
     * 移除指定状态对的全部守卫。
     */
    removeGuard<TFrom extends IState<TOwner>, TTo extends IState<TOwner>>(
        from : StateConstructor<TOwner, TFrom>,
        to   : StateConstructor<TOwner, TTo>,
    ): void;

    // ── 转换监听 ────────────────────────────────────────────────────────────

    /**
     * 注册全局转换监听器，每次状态切换时（含 setInitialState）触发。
     * 触发时机：onLeave 之后、onEnter 之前。
     *
     * @returns 句柄，调用 handle.off() 可随时注销
     *
     * @example
     * const handle = fsm.onTransition((from, to, owner) => {
     *     console.log(`${from?.stateName} → ${to.stateName}`);
     * });
     * // 不再需要时：
     * handle.off();
     */
    onTransition(callback: TransitionCallback<TOwner>): ITransitionHandle;
}
