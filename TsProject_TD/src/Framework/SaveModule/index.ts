/**
 * SaveSystem 公共 API 出口
 * 外部代码统一从此文件导入，无需关心内部目录结构。
 *
 * 使用示例：
 *   import { SaveSystem, SaveMode, ISaveSystem, ISaveModule, ISaveHandle } from "../SaveSystem";
 */

// ── 核心系统 ──────────────────────────────────────────────────────────────────
export { SaveSystem }             from "./SaveSystem";
export type { SaveSystemOptions } from "./SaveSystem";

// ── 存档模式 ──────────────────────────────────────────────────────────────────
export { SaveMode, SAVE_MODE_EXT } from "./SaveTypes";

// ── 可替换实现（供自定义扩展时使用） ─────────────────────────────────────────
export { JsonSaveSerializer }     from "./SaveSerializer";
export { PlatformSaveStorage }    from "./SaveStorage";

// ── 公共类型 ──────────────────────────────────────────────────────────────────
export { SAVE_FILE_EXT }          from "./SaveTypes";
export type {
    ISaveSystem,
    ISaveModule,
    ISaveHandle,
    ISaveSerializer,
    ISaveStorage,
    SaveKey,
} from "./SaveTypes";
