/**
 * GameModuleTypes — 游戏逻辑模块管理器类型定义
 *
 * 设计原则：
 *   - 低耦合：模块仅依赖 IGameModuleManager 获取其他模块，不直接引用
 *   - 高内聚：每个 IGameLogicModule 只负责一块游戏逻辑
 *   - 高性能：Map 按名 O(1) 查找，独立 update 列表避免每帧类型判断
 */

import type { GameFramework } from "../../Framework";

// ─── 游戏逻辑模块接口 ─────────────────────────────────────────────────────────

/**
 * 可注册到 GameModule 的游戏逻辑模块接口。
 * 模块间通过 manager.getModule() 获取其它模块，避免直接依赖。
 */
export interface IGameLogicModule {
    /** 全局唯一标识，用于注册与查找，建议与类名一致 */
    readonly moduleName: string;

    /**
     * 管理器完成注册后、首次 update 前调用。
     * 在此通过 manager.getModule() 解析依赖，勿在构造函数中依赖其它模块。
     */
    onInit(manager: IGameModuleManager): void;

    /** 每帧更新（可选），仅实现者会被加入 update 列表 */
    onUpdate?(deltaTime: number): void;

    /** 管理器 shutdown 时逆序调用，用于释放资源 */
    onShutdown(): void;
}

// ─── 游戏模块管理器接口 ───────────────────────────────────────────────────────

/**
 * 游戏逻辑模块管理器对外只读视图。
 * 供 IGameLogicModule.onInit 及业务代码获取模块与 Framework 引用。
 */
export interface IGameModuleManager {
    /** 框架单例引用，用于访问 ResSystem、EventSystem 等基础服务 */
    readonly framework: GameFramework;

    /**
     * 按名称获取已注册模块（强类型）。未找到时抛错，适用于确定存在的依赖。
     */
    getModule<T extends IGameLogicModule>(name: string): T;

    /**
     * 按名称安全获取模块，未找到返回 undefined，适用于可选依赖。
     */
    tryGetModule<T extends IGameLogicModule>(name: string): T | undefined;

    /** 是否已完成初始化（init 已被调用） */
    readonly isInitialized: boolean;
}
