/**
 * Framework 公共 API 出口
 * 外部代码统一从此文件导入，无需关心内部目录结构。
 *
 * 用法示例：
 *   import { GameFramework, IModule, FrameworkEvents, CoreModuleNames, EventSystem } from "../Framework";
 */

// ── 单例基类 ──────────────────────────────────────────────────────────────────
export { Singleton } from "./Single";

// ── 核心框架 ──────────────────────────────────────────────────────────────────
export { GameFramework, FrameworkEvents, CoreModuleNames } from "./GameFramework";
export type { IModule, FrameworkEventKey } from "./GameFramework";

// ── 事件系统 ──────────────────────────────────────────────────────────────────
export { EventSystem, EventBus }                                  from "./EventModule";
export type { IEventSystem, IEventBus, IEventHandle,
              IEventRegOptions, EventCallback }                   from "./EventModule";

// ── CPU / GPU 压力检测模块 ────────────────────────────────────────────────────
export { ComputingSystem } from "./CPUAndGPUComputing";
export type { ICpuStats, IGpuStats, IComputingSystem } from "./CPUAndGPUComputing";

// ── 日志模块 ──────────────────────────────────────────────────────────────────
export { LogSystem, LogLevel } from "./LogModule";
export type { ILogChannelHandle, ILogSystem } from "./LogModule";

// ── 计时器模块 ────────────────────────────────────────────────────────────────
export { TimerSystem, TimerType } from "./TimerModule";
export type { ITimerHandle, ITimerSystem } from "./TimerModule";

// ── 资源模块 ──────────────────────────────────────────────────────────────────
export { ResSystem, ResLoadType } from "./ResModule";
export type { IResHandle, IResSystem } from "./ResModule";

// ── 对象池模块 ────────────────────────────────────────────────────────────────
export { PoolSystem, SimpleFactory, ResettableFactory,
         GameObjectFactory, ResGameObjectFactory }         from "./PoolModule";
export type { IResettable, IPoolItemFactory, IPoolConfig,
              IGoPoolConfig, IPoolStats, IWarmupHandle,
              IPool, IPoolSystem }                         from "./PoolModule";

// ── 存档模块 ──────────────────────────────────────────────────────────────────
export { SaveSystem, SaveMode, SAVE_MODE_EXT,
         JsonSaveSerializer, PlatformSaveStorage,
         SAVE_FILE_EXT }                                   from "./SaveModule";
export type { SaveSystemOptions, ISaveSystem, ISaveModule,
              ISaveHandle, ISaveSerializer, ISaveStorage,
              SaveKey }                                     from "./SaveModule";

// ── 状态机模块 ────────────────────────────────────────────────────────────────
export { StateMachine, StateBase }                            from "./StateMachine";
export type { IStateBase, IState, IStateMachine,
              ITransitionHandle, StateConstructor,
              TransitionGuard, TransitionCallback }           from "./StateMachine";

// ── UI 模块 ───────────────────────────────────────────────────────────────────
export { UISystem, UIClass, getUIClassCtor,
         UIStage, UINodeBase, ViewBase,
         ModelBase, ServiceBase, UIComponent,
         UILayer, UIOpenMode, UIOpenFailReason }           from "./UISystem";
export type { UIOpenFailedCallback, IUIRuntimeConfig,
              IUIContext, IViewBase, IModelBase,
              IServiceBase, ViewConstructor,
              ModelConstructor, ServiceConstructor,
              ClassConstructor, IUIChildNode }              from "./UISystem";

// ── 场景模块 ──────────────────────────────────────────────────────────────────
export { SceneSystem, SceneLoadMode, SceneState,
         SceneLoadFailReason,
         SceneTransitionBase, NullSceneTransition,
         DelaySceneTransition }                            from "./SceneSystem";
export type { ISceneSystem, ISceneProgressHandle,
              ISceneLoadOptions, ISceneTransition }        from "./SceneSystem";

