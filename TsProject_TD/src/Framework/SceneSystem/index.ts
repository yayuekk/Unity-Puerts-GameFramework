/**
 * SceneSystem 公共 API 出口
 *
 * 外部代码统一从此文件导入，无需关心内部目录结构。
 *
 * 用法示例：
 *   import { SceneSystem, SceneLoadMode, NullSceneTransition } from "../Framework/SceneSystem";
 *   import type { ISceneSystem, ISceneProgressHandle, ISceneTransition } from "../Framework/SceneSystem";
 */

// ── 核心系统 ──────────────────────────────────────────────────────────────────
export { SceneSystem }                                      from "./SceneSystem";

// ── 类型 & 常量 ───────────────────────────────────────────────────────────────
export { SceneLoadMode, SceneState, SceneLoadFailReason }   from "./SceneTypes";
export type {
    ISceneSystem,
    ISceneProgressHandle,
    ISceneLoadOptions,
    ISceneTransition,
}                                                           from "./SceneTypes";

// ── 内置过渡策略 ──────────────────────────────────────────────────────────────
export {
    SceneTransitionBase,
    NullSceneTransition,
    DelaySceneTransition,
}                                                           from "./SceneTransition";
