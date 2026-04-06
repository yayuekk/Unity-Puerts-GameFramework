/**
 * SaveModuleHandle — 模块存档句柄（内部实现）
 *
 * 职责：管理某个逻辑模块下所有存档文件的增删查列操作。
 * 对应文件系统目录：{rootPath}/{moduleName}/
 *
 * 设计特点：
 *   - getHandle<T>() 是轻量工厂方法，每次创建新的 SaveHandle，不缓存数据
 *   - fileExt 由 SaveSystem 根据当前模式注入，驱动文件扩展名与过滤逻辑
 *   - 模块目录在构造时通过 ensureDir 自动创建
 *   - clearAll 删除并重建目录，保持模块目录始终存在
 */

import type { ISaveHandle, ISaveModule, ISaveSerializer, ISaveStorage } from "./SaveTypes";
import { SaveHandle } from "./SaveHandle";

// ─── SaveModuleHandle ─────────────────────────────────────────────────────────

export class SaveModuleHandle implements ISaveModule {

    readonly moduleName: string;

    private readonly _storage:    ISaveStorage;
    private readonly _serializer: ISaveSerializer;
    /** 当前存档模式对应的文件扩展名（".json" 或 ".sav"） */
    private readonly _fileExt:    string;

    constructor(
        moduleName: string,
        storage:    ISaveStorage,
        serializer: ISaveSerializer,
        fileExt:    string,
    ) {
        this.moduleName  = moduleName;
        this._storage    = storage;
        this._serializer = serializer;
        this._fileExt    = fileExt;
        storage.ensureDir(moduleName);
    }

    // ── ISaveModule ───────────────────────────────────────────────────────────

    listSaves(): string[] {
        return this._storage
            .listFiles(this.moduleName)
            .filter(f => f.endsWith(this._fileExt))
            .map(f => f.slice(0, -this._fileExt.length));
    }

    getHandle<T>(fileName: string): ISaveHandle<T> {
        return new SaveHandle<T>(
            this.moduleName,
            fileName,
            this._storage,
            this._serializer,
            this._fileExt,
        );
    }

    deleteSave(fileName: string): void {
        this._storage.deleteFile(
            `${this.moduleName}/${fileName}${this._fileExt}`,
        );
    }

    clearAll(): void {
        this._storage.deleteDir(this.moduleName);
        this._storage.ensureDir(this.moduleName);
    }
}
