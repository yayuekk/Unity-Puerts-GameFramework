/**
 * TypeScript 侧总入口 / Bootstrap
 *
 * 三层架构启动顺序：
 *   [Layer 1] Framework  — 基础服务层（Log / Timer / Res / Pool / Save / Scene / UI 等）
 *   [Layer 2] GAS        — 服务层（GameplayAbilitySystem：技能 / 属性 / 效果）
 *   [Layer 3] TD_Game    — 游戏逻辑层（波次 / 建造 / 寻路 / 经济等）
 *
 * 由 C# PuertsComponent（或自定义 MonoBehaviour）在 Awake/Start 中 require 此文件。
 *
 * C# 侧驱动约定：
 *   - 初始化：require("index")
 *   - 每帧更新：tsEnv.Eval<Action<float>>("exports.onUpdate")(Time.deltaTime)
 *   - 销毁：tsEnv.Eval<Action>("exports.onDestroy")()
 */

import { UnityEngine } from "csharp";
import {
    GameFramework,
    EventSystem,
    LogSystem,
    TimerSystem,
    ResSystem,
    PoolSystem,
    SaveSystem,
    ComputingSystem,
    SceneSystem,
    UISystem,
} from "./Framework/index";
import { GASLayer } from "./GameplayAbilitySystem";
import { TDGameLayer } from "./TD_Game";

// ── Bootstrap 启动横幅 ────────────────────────────────────────────────────────
console.log("[Bootstrap] ================================================");
console.log("[Bootstrap] TD Tower Defense — TypeScript Bootstrap");
console.log("[Bootstrap] ================================================");

// ── 编辑器下启用 source-map，方便调试定位 TS 行号 ─────────────────────────────
if (UnityEngine.Application.isEditor) {
    try {
        require("./debug/source-map-init");
        console.log("[Bootstrap] source-map-support enabled.");
    } catch {
        console.warn("[Bootstrap] source-map-support is not available.");
    }
}

// ── 创建框架单例 ──────────────────────────────────────────────────────────────
const framework = GameFramework.create();

// ── [Layer 1] 注册 Framework 基础服务模块（按依赖顺序排列）─────────────────────
// 底层模块（Event / Log / Timer / Res）须先注册，可直接用 framework.event / .log / .timer / .res 获取
console.log("[Bootstrap] [Layer 1] Registering Framework base modules...");
framework
    .registerModule(new EventSystem())     // 事件总线（底层，framework.event）
    .registerModule(new LogSystem())       // 日志（底层，framework.log）
    .registerModule(new TimerSystem())     // 计时器（底层，framework.timer）
    .registerModule(new ComputingSystem()) // CPU/GPU 性能采样
    .registerModule(new ResSystem())        // 资源（底层，framework.res）
    .registerModule(new PoolSystem())      // 对象池（依赖 Res）
    .registerModule(new SaveSystem())      // 存档
    .registerModule(new SceneSystem())     // 场景管理（依赖 Res）
    .registerModule(new UISystem());       // UI 系统（依赖 Res、Log）

// ── [Layer 2] 注册 GameplayAbilitySystem 服务层 ────────────────────────────────
console.log("[Bootstrap] [Layer 2] Registering GameplayAbilitySystem...");
framework.registerModule(new GASLayer());

// ── [Layer 3] 注册 TD_Game 游戏逻辑层 ─────────────────────────────────────────
console.log("[Bootstrap] [Layer 3] Registering TD_Game...");
framework.registerModule(new TDGameLayer());

// ── 按注册顺序依次调用所有模块的 onInit，完成后发出 fw:initComplete 事件 ────────
framework.init();
console.log("[Bootstrap] Bootstrap complete.");

// ── 向 C# 侧暴露生命周期钩子 ──────────────────────────────────────────────────

/**
 * C# 每帧调用（对应 Unity Update）：
 *   tsEnv.Eval<Action<float>>("exports.onUpdate")(Time.deltaTime);
 */
export function onUpdate(deltaTime: number): void {
    framework.update(deltaTime);
}

/**
 * C# 在 OnDestroy 中调用：
 *   tsEnv.Eval<Action>("exports.onDestroy")();
 */
export function onDestroy(): void {
    framework.shutdown();
}
