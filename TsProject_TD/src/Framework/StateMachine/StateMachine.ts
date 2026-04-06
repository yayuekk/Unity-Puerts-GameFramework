/**
 * StateMachine<TOwner> — 泛型状态机管理器
 *
 * 职责：
 *   - 管理状态实例的生命周期（懒创建、缓存复用、销毁）
 *   - 驱动状态切换流程（守卫检查 → onLeave → onEnter → 通知监听器）
 *   - 提供转换守卫与监听器的注册/注销接口
 *
 * 性能特性：
 *   - 状态实例在首次访问时懒创建，之后全程缓存复用，避免 GC 压力
 *   - update() 热路径：无额外对象分配，直接委托 _onUpdate 调用
 *   - 转换引擎为迭代循环（非递归），链式转换不占用额外调用栈
 *
 * 并发安全说明：
 *   JavaScript 为单线程，不存在真正的并发；同一转换流程内产生的
 *   重入 changeTo 请求会被放入单条目待处理槽，在本轮循环结束后
 *   自动执行，保证所有转换线性有序。
 *   注意：若在 onLeave/onEnter 中多次调用 changeTo，只有最后一次生效
 *   （后者覆盖前者），先前的请求静默丢弃。
 */

import type {
    IState,
    IStateBase,
    IStateMachine,
    ITransitionHandle,
    StateConstructor,
    TransitionCallback,
    TransitionGuard,
} from "./StateMachineTypes";

// ─── 内部：转换监听器条目 ──────────────────────────────────────────────────────

interface TransitionListener<TOwner> {
    readonly id : number;
    callback    : TransitionCallback<TOwner>;
    active      : boolean;
}

// ─── StateMachine ─────────────────────────────────────────────────────────────

export class StateMachine<TOwner> implements IStateMachine<TOwner> {

    private readonly _owner      : TOwner;
    private _current             : IState<TOwner> | null = null;
    private _previous            : IState<TOwner> | null = null;
    private _isRunning           : boolean = false;
    private _isTransitioning     : boolean = false;
    private _pendingState        : StateConstructor<TOwner> | null = null;

    /** 状态实例缓存：class constructor → instance（Map 保持插入顺序，遍历有序） */
    private readonly _cache = new Map<StateConstructor<TOwner>, IState<TOwner>>();

    /**
     * 转换守卫双层 Map：fromCtor → toCtor → guards[]
     * 以构造函数引用为 key，避免类名碰撞，O(1) 查找。
     */
    private readonly _guards = new Map<
        StateConstructor<TOwner>,
        Map<StateConstructor<TOwner>, Array<TransitionGuard<TOwner>>>
    >();

    private readonly _listeners  : Array<TransitionListener<TOwner>> = [];
    private _listenerIdSeq       : number = 0;

    // ── 构造 ──────────────────────────────────────────────────────────────────

    /**
     * @param owner 宿主对象，通常传入 `this`。
     *              宿主引用在整个状态机生命周期内持有，
     *              所有状态通过 this.owner 访问宿主数据。
     */
    constructor(owner: TOwner) {
        this._owner = owner;
    }

    // ── 只读属性 ──────────────────────────────────────────────────────────────

    get owner()            : TOwner            { return this._owner;        }
    get currentState()     : IStateBase | null { return this._current;      }
    get previousState()    : IStateBase | null { return this._previous;     }
    get isRunning()        : boolean           { return this._isRunning;    }
    get cachedStateCount() : number            { return this._cache.size;   }

    // ── 核心控制 ──────────────────────────────────────────────────────────────

    setInitialState<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): void {
        if (this._isRunning) {
            this.changeTo(StateClass);
            return;
        }
        this._isRunning = true;
        // 初始进入：无 "from" 状态，无需守卫检查，直接启动转换循环
        this._runTransitionLoop(StateClass, true);
    }

    /**
     * 切换到目标状态。
     *
     * 执行流程：
     *   1. 守卫检查（addGuard 注册的条件），失败则返回 false
     *   2. 若当前正在转换中，将请求放入待处理槽（本轮循环结束后自动执行）
     *   3. 守卫已通过，启动转换循环
     *
     * @returns
     *   true  — 转换已执行或已加入待处理队列
     *   false — 被守卫阻止、或状态机尚未启动
     */
    changeTo<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): boolean {
        if (!this._isRunning) return false;

        // 此时 _current 即为"from 状态"，守卫在调用方即检查，确保语义正确
        if (!this._checkGuards(this._current, StateClass)) return false;

        if (this._isTransitioning) {
            // 重入保护：将请求排队，待本轮转换流程完成后执行
            // 注意：多次调用时只保留最后一次（后者覆盖前者）
            this._pendingState = StateClass;
            return true;
        }

        // 守卫已在上方检查，循环首轮跳过重复检查
        this._runTransitionLoop(StateClass, true);
        return true;
    }

    /** 驱动当前状态的 onUpdate。热路径：无额外分配，直接委托调用。 */
    update(dt: number): void {
        if (this._isRunning && this._current !== null) {
            this._current._onUpdate(dt);
        }
    }

    destroy(): void {
        if (!this._isRunning && this._cache.size === 0) return;

        // 立即停止运行，防止 onDestroy 回调中触发新的转换
        this._isRunning       = false;
        this._isTransitioning = false;
        this._pendingState    = null;

        this._cache.forEach(state => {
            try { state._onDestroy(); }
            catch (e) {
                console.error(`[StateMachine] onDestroy threw in "${state.stateName}":`, e);
            }
        });

        this._cache.clear();
        this._guards.clear();
        this._listeners.length = 0;
        this._current  = null;
        this._previous = null;
    }

    // ── 查询 ──────────────────────────────────────────────────────────────────

    isInState<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): boolean {
        return this._current instanceof StateClass;
    }

    getState<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): T {
        return this._getOrCreate(StateClass) as T;
    }

    // ── 守卫 ──────────────────────────────────────────────────────────────────

    addGuard<TFrom extends IState<TOwner>, TTo extends IState<TOwner>>(
        from  : StateConstructor<TOwner, TFrom>,
        to    : StateConstructor<TOwner, TTo>,
        guard : TransitionGuard<TOwner>,
    ): void {
        let toMap = this._guards.get(from);
        if (toMap === undefined) {
            toMap = new Map();
            this._guards.set(from, toMap);
        }

        let guards = toMap.get(to);
        if (guards === undefined) {
            guards = [];
            toMap.set(to, guards);
        }

        guards.push(guard);
    }

    removeGuard<TFrom extends IState<TOwner>, TTo extends IState<TOwner>>(
        from : StateConstructor<TOwner, TFrom>,
        to   : StateConstructor<TOwner, TTo>,
    ): void {
        this._guards.get(from)?.delete(to);
    }

    // ── 转换监听 ──────────────────────────────────────────────────────────────

    onTransition(callback: TransitionCallback<TOwner>): ITransitionHandle {
        const id    = ++this._listenerIdSeq;
        const entry : TransitionListener<TOwner> = { id, callback, active: true };
        this._listeners.push(entry);

        return {
            get id()       { return id;           },
            get isActive() { return entry.active; },
            off: ()        => { entry.active = false; },
        };
    }

    // ── 内部实现 ──────────────────────────────────────────────────────────────

    /**
     * 获取或创建状态实例。
     * 首次创建后缓存，后续直接返回缓存实例（O(1)）。
     *
     * 创建流程：new StateClass() → _setup(owner, machine) → _onInit() → 写入缓存
     *
     * 关键：_cache.set 在 _onInit() 成功之后执行。
     * 若 _onInit()（即业务 onInit()）抛出异常，状态不会进入缓存，
     * 下次调用时会重新创建一个干净的实例并重试初始化。
     */
    private _getOrCreate<T extends IState<TOwner>>(StateClass: StateConstructor<TOwner, T>): T {
        let instance = this._cache.get(StateClass) as T | undefined;
        if (instance === undefined) {
            instance = new StateClass();
            instance._setup(this._owner, this);
            instance._onInit();              // 若抛出，状态不写入缓存，保持可重试性
            this._cache.set(StateClass, instance); // 仅初始化成功后缓存
        }
        return instance;
    }

    /**
     * 检查 from → to 的所有守卫（AND 关系）。
     * from 为 null（初始状态进入）时，直接放行。
     */
    private _checkGuards(
        from : IState<TOwner> | null,
        to   : StateConstructor<TOwner>,
    ): boolean {
        if (from === null) return true;

        const fromCtor = from.constructor as StateConstructor<TOwner>;
        const toMap    = this._guards.get(fromCtor);
        if (toMap === undefined) return true;

        const guards = toMap.get(to);
        if (guards === undefined || guards.length === 0) return true;

        const toName = (to as { name?: string }).name ?? "unknown";
        for (const guard of guards) {
            if (!guard(this._owner, from, toName)) return false;
        }
        return true;
    }

    /**
     * 状态转换迭代引擎。
     *
     * 设计要点：
     *   - 迭代而非递归：链式转换（A→B→C→...）在同一个 while 循环内完成，
     *     不产生额外调用栈，消除栈溢出风险。
     *   - _isTransitioning 在每次步进时显式设置/清除，异常路径通过 break
     *     退出循环后也能保证标志被复位（循环末尾统一执行）。
     *   - 首轮跳过守卫检查（调用方已预先验证）；后续链式转换重新检查
     *     守卫（此时 _current 已是最新的 from 状态，语义正确）。
     *
     * @param firstClass     首个目标状态类
     * @param skipFirstGuard 首轮是否跳过守卫检查（调用方已完成检查时传 true）
     */
    private _runTransitionLoop(
        firstClass     : StateConstructor<TOwner>,
        skipFirstGuard : boolean,
    ): void {
        let toClass     : StateConstructor<TOwner> | null = firstClass;
        let isFirstStep : boolean = true;

        while (toClass !== null) {
            const currentToClass = toClass;
            toClass = null;

            // 链式（pending）转换使用最新的 _current 重新检查守卫
            // 首轮守卫已由调用方验证，跳过以避免重复检查
            if (isFirstStep) {
                isFirstStep = false;
                if (!skipFirstGuard && !this._checkGuards(this._current, currentToClass)) break;
            } else {
                if (!this._checkGuards(this._current, currentToClass)) break;
            }

            // ── 标志置位：后续所有 changeTo 调用将排入 _pendingState ──────────
            this._isTransitioning = true;

            // 创建/获取目标状态实例；若 onInit() 抛出则中止本次转换
            let nextState: IState<TOwner>;
            try {
                nextState = this._getOrCreate(currentToClass);
            } catch (e) {
                this._isTransitioning = false;
                console.error(
                    `[StateMachine] Failed to create or initialize state ` +
                    `"${(currentToClass as { name?: string }).name ?? "unknown"}":`, e,
                );
                break;
            }

            const prevState = this._current;

            // ── onLeave：通知当前状态即将离开 ───────────────────────────────────
            if (prevState !== null) {
                try { prevState._onLeave(nextState); }
                catch (e) {
                    console.error(`[StateMachine] onLeave threw in "${prevState.stateName}":`, e);
                }
            }

            // ── 切换引用：此后 currentState / previousState 已更新 ──────────────
            this._previous = prevState;
            this._current  = nextState;

            // ── 通知监听器（onLeave 之后、onEnter 之前）────────────────────────
            this._notifyListeners(prevState, nextState);

            // ── onEnter：通知新状态已进入 ────────────────────────────────────────
            try { nextState._onEnter(prevState); }
            catch (e) {
                console.error(`[StateMachine] onEnter threw in "${nextState.stateName}":`, e);
            }

            // ── 标志复位：此后 changeTo 调用将直接执行而非排队 ──────────────────
            this._isTransitioning = false;

            // ── 提取并消费待处理请求，驱动下一轮循环 ───────────────────────────
            if (this._pendingState !== null) {
                toClass            = this._pendingState;
                this._pendingState = null;
            }
        }

        // 确保因 break 退出循环时标志被复位
        this._isTransitioning = false;
    }

    /**
     * 通知所有活跃的转换监听器（前向遍历，FIFO 顺序）。
     * 遍历过程中同步清理已注销（active=false）的条目。
     * 回调异常不阻断后续监听器。
     */
    private _notifyListeners(from: IStateBase | null, to: IStateBase): void {
        let i = 0;
        while (i < this._listeners.length) {
            const entry = this._listeners[i];
            if (!entry.active) {
                this._listeners.splice(i, 1);
                continue;
            }
            try { entry.callback(from, to, this._owner); }
            catch (e) {
                console.error(`[StateMachine] onTransition callback threw:`, e);
            }
            i++;
        }
    }
}
