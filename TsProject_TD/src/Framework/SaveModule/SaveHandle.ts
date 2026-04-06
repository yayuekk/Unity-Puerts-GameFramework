/**
 * SaveHandle — 单个存档文件的类型化操作句柄（内部实现）
 *
 * 设计特点：
 *   - 轻量值对象，不持有数据缓存，每次 load / save 均直接触发 IO
 *   - 通过构造时注入的 storage 与 serializer 实现解耦（依赖注入）
 *   - fileExt 由 SaveSystem 根据当前模式注入（Dev=".json" / Release=".sav"）
 *   - 由 SaveModuleHandle.getHandle<T>() 工厂方法创建，不对外暴露构造函数
 */

import type { ISaveHandle, ISaveSerializer, ISaveStorage, SaveKey } from "./SaveTypes";

// ─── SaveHandle ───────────────────────────────────────────────────────────────

export class SaveHandle<T> implements ISaveHandle<T> {

    readonly key: SaveKey;

    private readonly _storage:      ISaveStorage;
    private readonly _serializer:   ISaveSerializer;
    /** 相对于存档根目录的文件路径，如 "Player/slot_0.json" 或 "Player/slot_0.sav" */
    private readonly _relativePath: string;

    constructor(
        moduleName: string,
        fileName:   string,
        storage:    ISaveStorage,
        serializer: ISaveSerializer,
        fileExt:    string,
    ) {
        this.key             = { moduleName, fileName };
        this._storage        = storage;
        this._serializer     = serializer;
        this._relativePath   = `${moduleName}/${fileName}${fileExt}`;
    }

    // ── ISaveHandle ───────────────────────────────────────────────────────────

    exists(): boolean {
        return this._storage.fileExists(this._relativePath);
    }

    load(): T | undefined {
        const raw = this._storage.read(this._relativePath);
        if (raw === null) return undefined;
        try {
            return this._serializer.deserialize<T>(raw);
        } catch (e) {
            console.error(
                `[SaveHandle] Deserialize failed: "${this._relativePath}"`, e,
            );
            return undefined;
        }
    }

    save(data: T): void {
        try {
            const raw = this._serializer.serialize(data);
            this._storage.write(this._relativePath, raw);
        } catch (e) {
            console.error(
                `[SaveHandle] Serialize failed: "${this._relativePath}"`, e,
            );
            throw e;
        }
    }

    delete(): void {
        this._storage.deleteFile(this._relativePath);
    }
}
