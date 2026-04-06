/**
 * EventSystem — 事件系统核心模块
 *
 * 职责：
 *   1. 实现 IModule，接入 GameFramework 生命周期（onInit / onUpdate / onShutdown）
 *   2. 继承 EventBus，自身即全局事件总线（framework.event）
 *   3. 按需创建并缓存模块专属总线（EventBus 实例），同一模块名保证唯一实例
 *   4. 每帧驱动全局总线与所有模块总线的延迟事件倒计时
 *
 * 设计模式：
 *   - 继承（Inheritance）：EventSystem 直接继承 EventBus，无需委托代理
 *   - 工厂方法（Factory Method）：getOrCreateModule() 按需创建隔离的模块总线
 *
 * 公共总线 vs 模块总线：
 *   - 公共总线（framework.event）：全局共享，适合跨模块通信
 *   - 模块总线（getOrCreateModule）：完全隔离的命名空间，适合模块内部事件
 *
 * 注册示例：
 *   framework.registerModule(new EventSystem());
 *
 * 使用示例（公共总线）：
 *   const ev = framework.event;
 *   ev.on("playerDied", this.onPlayerDied, { context: this, priority: 20 });
 *   ev.emit("playerDied", player);
 *   ev.emitDeferred("reward", 2000, goldAmount); // 2 秒后触发
 *   ev.emitUnicast("requestHandler", payload);   // 只触发优先级最高的监听器
 *
 * 使用示例（模块专属总线）：
 *   const battle = ev.getOrCreateModule("Battle");
 *   battle.on("enemyDied", this.onEnemyDied, { context: this });
 *   battle.emit("enemyDied", enemy);
 *   ev.removeModule("Battle"); // 销毁并清除 Battle 模块的所有监听器
 */

import type { GameFramework, IModule } from "../GameFramework";
import type { IEventSystem, IEventBus } from "./EventTypes";
import { EventBus } from "./EventBus";

export class EventSystem extends EventBus implements IModule, IEventSystem {

    readonly moduleName = "EventSystem";

    private readonly _moduleMap = new Map<string, EventBus>();

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(_fw: GameFramework): void {
        console.log("[EventSystem] Initialized.");
    }

    /** 每帧驱动全局总线与所有模块总线的延迟事件倒计时（deltaTime 单位：秒） */
    onUpdate(deltaTime: number): void {
        const deltaMs = deltaTime * 1000;
        this.update(deltaMs);
        for (const mod of this._moduleMap.values()) {
            mod.update(deltaMs);
        }
    }

    onShutdown(): void {
        this.clear();
        for (const mod of this._moduleMap.values()) {
            mod.clear();
        }
        this._moduleMap.clear();
        console.log("[EventSystem] Shutdown.");
    }

    // ── IEventSystem：模块总线管理 ────────────────────────────────────────────

    getOrCreateModule(moduleName: string): IEventBus {
        let mod = this._moduleMap.get(moduleName);
        if (!mod) {
            mod = new EventBus();
            this._moduleMap.set(moduleName, mod);
        }
        return mod;
    }

    getModule(moduleName: string): IEventBus | undefined {
        return this._moduleMap.get(moduleName);
    }

    removeModule(moduleName: string): void {
        const mod = this._moduleMap.get(moduleName);
        if (mod) {
            mod.clear();
            this._moduleMap.delete(moduleName);
        }
    }
}
