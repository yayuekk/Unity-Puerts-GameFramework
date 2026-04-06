"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUpdate = onUpdate;
exports.onDestroy = onDestroy;
const csharp_1 = require("csharp");
const index_1 = require("./Framework/index");
const GameplayAbilitySystem_1 = require("./GameplayAbilitySystem");
const TD_Game_1 = require("./TD_Game");
// ── Bootstrap 启动横幅 ────────────────────────────────────────────────────────
console.log("[Bootstrap] ================================================");
console.log("[Bootstrap] TD Tower Defense — TypeScript Bootstrap");
console.log("[Bootstrap] ================================================");
// ── 编辑器下启用 source-map，方便调试定位 TS 行号 ─────────────────────────────
if (csharp_1.UnityEngine.Application.isEditor) {
    try {
        require("./debug/source-map-init");
        console.log("[Bootstrap] source-map-support enabled.");
    }
    catch {
        console.warn("[Bootstrap] source-map-support is not available.");
    }
}
// ── 创建框架单例 ──────────────────────────────────────────────────────────────
const framework = index_1.GameFramework.create();
// ── [Layer 1] 注册 Framework 基础服务模块（按依赖顺序排列）─────────────────────
// 底层模块（Event / Log / Timer / Res）须先注册，可直接用 framework.event / .log / .timer / .res 获取
console.log("[Bootstrap] [Layer 1] Registering Framework base modules...");
framework
    .registerModule(new index_1.EventSystem()) // 事件总线（底层，framework.event）
    .registerModule(new index_1.LogSystem()) // 日志（底层，framework.log）
    .registerModule(new index_1.TimerSystem()) // 计时器（底层，framework.timer）
    .registerModule(new index_1.ComputingSystem()) // CPU/GPU 性能采样
    .registerModule(new index_1.ResSystem()) // 资源（底层，framework.res）
    .registerModule(new index_1.PoolSystem()) // 对象池（依赖 Res）
    .registerModule(new index_1.SaveSystem()) // 存档
    .registerModule(new index_1.SceneSystem()) // 场景管理（依赖 Res）
    .registerModule(new index_1.UISystem()); // UI 系统（依赖 Res、Log）
// ── [Layer 2] 注册 GameplayAbilitySystem 服务层 ────────────────────────────────
console.log("[Bootstrap] [Layer 2] Registering GameplayAbilitySystem...");
framework.registerModule(new GameplayAbilitySystem_1.GASLayer());
// ── [Layer 3] 注册 TD_Game 游戏逻辑层 ─────────────────────────────────────────
console.log("[Bootstrap] [Layer 3] Registering TD_Game...");
framework.registerModule(new TD_Game_1.TDGameLayer());
// ── 按注册顺序依次调用所有模块的 onInit，完成后发出 fw:initComplete 事件 ────────
framework.init();
console.log("[Bootstrap] Bootstrap complete.");
// ── 向 C# 侧暴露生命周期钩子 ──────────────────────────────────────────────────
/**
 * C# 每帧调用（对应 Unity Update）：
 *   tsEnv.Eval<Action<float>>("exports.onUpdate")(Time.deltaTime);
 */
function onUpdate(deltaTime) {
    framework.update(deltaTime);
}
/**
 * C# 在 OnDestroy 中调用：
 *   tsEnv.Eval<Action>("exports.onDestroy")();
 */
function onDestroy() {
    framework.shutdown();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguY2pzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vVHNQcm9qZWN0X1REL3NyYy9pbmRleC5jdHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7OztHQWNHOztBQW9FSCw0QkFFQztBQU1ELDhCQUVDO0FBNUVELG1DQUFxQztBQUNyQyw2Q0FXMkI7QUFDM0IsbUVBQW1EO0FBQ25ELHVDQUF3QztBQUV4Qyw2RUFBNkU7QUFDN0UsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4REFBOEQsQ0FBQyxDQUFDO0FBQzVFLE9BQU8sQ0FBQyxHQUFHLENBQUMscURBQXFELENBQUMsQ0FBQztBQUNuRSxPQUFPLENBQUMsR0FBRyxDQUFDLDhEQUE4RCxDQUFDLENBQUM7QUFFNUUsa0VBQWtFO0FBQ2xFLElBQUksb0JBQVcsQ0FBQyxXQUFXLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDbkMsSUFBSSxDQUFDO1FBQ0QsT0FBTyxDQUFDLHlCQUF5QixDQUFDLENBQUM7UUFDbkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDO0lBQzNELENBQUM7SUFBQyxNQUFNLENBQUM7UUFDTCxPQUFPLENBQUMsSUFBSSxDQUFDLGtEQUFrRCxDQUFDLENBQUM7SUFDckUsQ0FBQztBQUNMLENBQUM7QUFFRCwyRUFBMkU7QUFDM0UsTUFBTSxTQUFTLEdBQUcscUJBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztBQUV6QyxpRUFBaUU7QUFDakUscUZBQXFGO0FBQ3JGLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkRBQTZELENBQUMsQ0FBQztBQUMzRSxTQUFTO0tBQ0osY0FBYyxDQUFDLElBQUksbUJBQVcsRUFBRSxDQUFDLENBQUssMkJBQTJCO0tBQ2pFLGNBQWMsQ0FBQyxJQUFJLGlCQUFTLEVBQUUsQ0FBQyxDQUFPLHVCQUF1QjtLQUM3RCxjQUFjLENBQUMsSUFBSSxtQkFBVyxFQUFFLENBQUMsQ0FBSywwQkFBMEI7S0FDaEUsY0FBYyxDQUFDLElBQUksdUJBQWUsRUFBRSxDQUFDLENBQUMsZUFBZTtLQUNyRCxjQUFjLENBQUMsSUFBSSxpQkFBUyxFQUFFLENBQUMsQ0FBUSx1QkFBdUI7S0FDOUQsY0FBYyxDQUFDLElBQUksa0JBQVUsRUFBRSxDQUFDLENBQU0sY0FBYztLQUNwRCxjQUFjLENBQUMsSUFBSSxrQkFBVSxFQUFFLENBQUMsQ0FBTSxLQUFLO0tBQzNDLGNBQWMsQ0FBQyxJQUFJLG1CQUFXLEVBQUUsQ0FBQyxDQUFLLGVBQWU7S0FDckQsY0FBYyxDQUFDLElBQUksZ0JBQVEsRUFBRSxDQUFDLENBQUMsQ0FBTyxvQkFBb0I7QUFFL0QsNkVBQTZFO0FBQzdFLE9BQU8sQ0FBQyxHQUFHLENBQUMsNERBQTRELENBQUMsQ0FBQztBQUMxRSxTQUFTLENBQUMsY0FBYyxDQUFDLElBQUksZ0NBQVEsRUFBRSxDQUFDLENBQUM7QUFFekMsMEVBQTBFO0FBQzFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsOENBQThDLENBQUMsQ0FBQztBQUM1RCxTQUFTLENBQUMsY0FBYyxDQUFDLElBQUkscUJBQVcsRUFBRSxDQUFDLENBQUM7QUFFNUMsNkRBQTZEO0FBQzdELFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUNqQixPQUFPLENBQUMsR0FBRyxDQUFDLGlDQUFpQyxDQUFDLENBQUM7QUFFL0MsdUVBQXVFO0FBRXZFOzs7R0FHRztBQUNILFNBQWdCLFFBQVEsQ0FBQyxTQUFpQjtJQUN0QyxTQUFTLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ2hDLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFnQixTQUFTO0lBQ3JCLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztBQUN6QixDQUFDIn0=