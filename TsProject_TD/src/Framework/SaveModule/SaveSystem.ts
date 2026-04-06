/**
 * SaveSystem — 存档系统核心模块
 *
 * 职责：
 *   1. 实现 IModule，接入 GameFramework 生命周期（onInit / onShutdown）
 *   2. 按需创建并缓存 SaveModuleHandle，同一模块名保证唯一实例
 *   3. 通过构造参数支持序列化策略与存储适配器的依赖注入
 *   4. 管理存档模式（Dev / Release）并在模式切换时自动清除旧格式存档
 *
 * 存档目录结构（Dev 模式）：
 *   {Application.persistentDataPath}/
 *     Saves/
 *       Player/
 *         slot_0.json      ← 明文 JSON，可直接阅读
 *
 * 存档目录结构（Release 模式）：
 *   {Application.persistentDataPath}/
 *     Saves/
 *       Player/
 *         slot_0.sav       ← UTF-8 二进制，不易直接阅读
 *
 * 模式切换机制：
 *   - 使用 UnityEngine.PlayerPrefs 持久化上次使用的模式
 *   - onInit 时若检测到模式与上次不同，自动删除全部旧存档并记录新模式
 *   - 此行为仅在使用 PlatformSaveStorage 时触发（注入自定义 storage 时跳过）
 *
 * 注册示例：
 *   // 根据是否在编辑器中自动选择模式
 *   framework.registerModule(new SaveSystem({
 *       mode: UnityEngine.Application.isEditor ? SaveMode.Dev : SaveMode.Release,
 *   }));
 *
 * 使用示例：
 *   const save = framework.getModule<SaveSystem>("SaveSystem");
 *   const handle = save.getModule("Player").getHandle<PlayerData>("slot_0");
 *   handle.save({ level: 5, gold: 1000 });
 *   const data = handle.load(); // PlayerData | undefined
 */

import type { GameFramework, IModule } from "../GameFramework";
import type { ISaveSerializer, ISaveStorage, ISaveModule, ISaveSystem } from "./SaveTypes";
import { SaveMode, SAVE_MODE_EXT }  from "./SaveTypes";
import { JsonSaveSerializer }       from "./SaveSerializer";
import { PlatformSaveStorage }      from "./SaveStorage";
import { SaveModuleHandle }         from "./SaveModuleHandle";
import { UnityEngine }              from "csharp";

// ─── PlayerPrefs 键 ───────────────────────────────────────────────────────────

/** 持久化存档模式的 PlayerPrefs 键名 */
const PREF_KEY_MODE = "SaveSystem_Mode";

// ─── 构造选项 ──────────────────────────────────────────────────────────────────

export interface SaveSystemOptions {
    /**
     * 存档模式（Dev = 明文 JSON / Release = 二进制 SAV）。
     *
     * 推荐根据运行环境自动选择：
     *   mode: UnityEngine.Application.isEditor ? SaveMode.Dev : SaveMode.Release
     *
     * 默认值：SaveMode.Release
     */
    mode?: SaveMode;

    /**
     * 存档根目录名称（相对于 persistentDataPath）。
     * 默认值："Saves"
     */
    subDir?: string;

    /**
     * 自定义序列化策略（Strategy Pattern）。
     * 默认值：JsonSaveSerializer（紧凑格式）
     */
    serializer?: ISaveSerializer;

    /**
     * 自定义存储适配器（依赖注入，用于测试或特殊平台）。
     * 若提供，则忽略 subDir、mode 参数，且不执行模式切换检测。
     */
    storage?: ISaveStorage;
}

// ─── SaveSystem ───────────────────────────────────────────────────────────────

export class SaveSystem implements IModule, ISaveSystem {

    readonly moduleName = "SaveSystem";

    private _storage:    ISaveStorage | undefined;
    private _serializer: ISaveSerializer;

    private readonly _mode:        SaveMode;
    private readonly _fileExt:     string;
    private readonly _options:     SaveSystemOptions;
    private readonly _moduleCache: Map<string, SaveModuleHandle> = new Map();

    constructor(options: SaveSystemOptions = {}) {
        this._options    = options;
        this._mode       = options.mode ?? SaveMode.Release;
        this._fileExt    = SAVE_MODE_EXT[this._mode];
        this._serializer = options.serializer ?? new JsonSaveSerializer();
        if (options.storage) {
            this._storage = options.storage;
        }
    }

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(_fw: GameFramework): void {
        if (!this._storage) {
            const isTextMode = this._mode === SaveMode.Dev;
            this._storage = new PlatformSaveStorage(
                this._options.subDir ?? "Saves",
                isTextMode,
            );
            this._detectAndHandleModeChange();
        }
        console.log(
            `[SaveSystem] Initialized. Mode: ${this._mode}, Ext: ${this._fileExt}, Root: ${this._storage.rootPath}`,
        );
    }

    onShutdown(): void {
        this._moduleCache.clear();
        console.log("[SaveSystem] Shutdown.");
    }

    // ── ISaveSystem ───────────────────────────────────────────────────────────

    get mode(): SaveMode {
        return this._mode;
    }

    get serializer(): ISaveSerializer {
        return this._serializer;
    }

    getModule(moduleName: string): ISaveModule {
        this._assertStorage();
        let handle = this._moduleCache.get(moduleName);
        if (!handle) {
            handle = new SaveModuleHandle(
                moduleName,
                this._storage!,
                this._serializer,
                this._fileExt,
            );
            this._moduleCache.set(moduleName, handle);
        }
        return handle;
    }

    clearModule(moduleName: string): void {
        this._assertStorage();
        this._storage!.deleteDir(moduleName);
        this._moduleCache.delete(moduleName);
    }

    listModules(): string[] {
        this._assertStorage();
        return this._storage!.listRootDirs();
    }

    // ── 运行时替换序列化策略 ──────────────────────────────────────────────────

    /**
     * 替换序列化策略（可在运行时动态切换）。
     * 会清空模块句柄缓存，确保后续 getModule 使用新序列化器创建句柄。
     * 已写入磁盘的存档不受影响，需使用相同序列化器才能正确读取。
     */
    setSerializer(serializer: ISaveSerializer): this {
        this._serializer = serializer;
        this._moduleCache.clear();
        return this;
    }

    // ── 模式切换检测（私有） ──────────────────────────────────────────────────

    /**
     * 检测存档模式是否与上次运行时不同。
     * 若不同，则清除所有旧存档后更新 PlayerPrefs 记录。
     * 仅在使用 PlatformSaveStorage 时调用（注入自定义 storage 时跳过）。
     */
    private _detectAndHandleModeChange(): void {
        const prevMode = UnityEngine.PlayerPrefs.GetString(PREF_KEY_MODE, "");

        if (prevMode !== "" && prevMode !== this._mode) {
            console.warn(
                `[SaveSystem] Save mode changed: "${prevMode}" → "${this._mode}". ` +
                `Clearing all existing saves to avoid format mismatch.`,
            );
            this._clearAllSaves();
        }

        UnityEngine.PlayerPrefs.SetString(PREF_KEY_MODE, this._mode);
        UnityEngine.PlayerPrefs.Save();
    }

    /** 删除所有模块目录下的存档（根目录本身保留） */
    private _clearAllSaves(): void {
        const dirs = this._storage!.listRootDirs();
        for (const dir of dirs) {
            this._storage!.deleteDir(dir);
        }
        this._moduleCache.clear();
    }

    // ── 私有工具 ──────────────────────────────────────────────────────────────

    private _assertStorage(): void {
        if (!this._storage) {
            throw new Error("[SaveSystem] Not initialized. Call framework.init() first.");
        }
    }
}
