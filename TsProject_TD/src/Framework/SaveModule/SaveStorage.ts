/**
 * SaveStorage — 基于 System.IO 的跨平台存储适配器（Adapter Pattern）
 *
 * 核心特性：
 *   - 根路径使用 UnityEngine.Application.persistentDataPath
 *     → PC（Windows/macOS/Linux）、Android、iOS 均可读写
 *   - Dev 模式（textMode=true）：
 *       string → File.WriteAllText → .json 明文文件（可直接用文本编辑器打开）
 *   - Release 模式（textMode=false）：
 *       string → UTF-8 字节 → File.WriteAllBytes → .sav 二进制文件
 *   - 目录按需自动创建，删除操作均做存在性检查（静默忽略缺失项）
 *
 * 各平台 persistentDataPath 示例：
 *   PC      : C:/Users/{user}/AppData/LocalLow/{company}/{product}
 *   Android : /data/user/0/{packageName}/files
 *   iOS     : /var/mobile/Containers/Data/Application/{UUID}/Documents
 */

import type { ISaveStorage } from "./SaveTypes";
import { System, UnityEngine } from "csharp";

// ─── 局部接口：仅描述本文件实际使用的 C# 方法签名 ────────────────────────────
//
// Puerts 的类型生成不覆盖 System.IO / System.Text 等子命名空间，
// 运行时完全可用，但 TypeScript 层面不识别，故通过 `as any` 取出后
// 用精简接口重新约束，保留调用处的类型提示。

interface ISysPath {
    Combine(...paths: string[]): string;
    GetDirectoryName(path: string): string | null;
    GetFileName(path: string): string;
}
interface ISysFile {
    Exists(path: string): boolean;
    Delete(path: string): void;
    WriteAllBytes(path: string, bytes: unknown): void;
    ReadAllBytes(path: string): unknown;
    WriteAllText(path: string, content: string, encoding: unknown): void;
    ReadAllText(path: string, encoding: unknown): string;
}
interface ISysDir {
    Exists(path: string): boolean;
    CreateDirectory(path: string): void;
    Delete(path: string, recursive: boolean): void;
    GetFiles(path: string): ArrayLike<string> & { Length: number };
    GetDirectories(path: string): ArrayLike<string> & { Length: number };
}
interface ISysEncoding {
    UTF8: {
        GetBytes(str: string): unknown;
        GetString(bytes: unknown): string;
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _CS      = System as any;
const SysPath  = _CS.IO.Path       as ISysPath;
const SysFile  = _CS.IO.File       as ISysFile;
const SysDir   = _CS.IO.Directory  as ISysDir;
const Encoding = _CS.Text.Encoding as ISysEncoding;

// ─── PlatformSaveStorage ──────────────────────────────────────────────────────

export class PlatformSaveStorage implements ISaveStorage {

    private readonly _root:     string;
    private readonly _textMode: boolean;

    /**
     * @param subDir    存档根目录名称（相对于 persistentDataPath），默认 "Saves"
     * @param textMode  true = Dev 模式，使用明文 WriteAllText；
     *                  false = Release 模式，使用二进制 WriteAllBytes（默认）
     */
    constructor(subDir: string = "Saves", textMode: boolean = false) {
        this._root     = SysPath.Combine(
            UnityEngine.Application.persistentDataPath,
            subDir,
        );
        this._textMode = textMode;
        SysDir.CreateDirectory(this._root);
    }

    get rootPath(): string { return this._root; }

    // ── 核心 IO ───────────────────────────────────────────────────────────────

    write(relativePath: string, content: string): void {
        const fullPath = this._abs(relativePath);
        const dir = SysPath.GetDirectoryName(fullPath);
        if (dir) SysDir.CreateDirectory(dir);

        if (this._textMode) {
            // Dev 模式：明文 UTF-8 文本，可直接用编辑器打开
            SysFile.WriteAllText(fullPath, content, Encoding.UTF8);
        } else {
            // Release 模式：UTF-8 字节写入二进制文件
            SysFile.WriteAllBytes(fullPath, Encoding.UTF8.GetBytes(content));
        }
    }

    read(relativePath: string): string | null {
        const fullPath = this._abs(relativePath);
        if (!SysFile.Exists(fullPath)) return null;

        if (this._textMode) {
            return SysFile.ReadAllText(fullPath, Encoding.UTF8);
        } else {
            return Encoding.UTF8.GetString(SysFile.ReadAllBytes(fullPath));
        }
    }

    // ── 文件操作 ──────────────────────────────────────────────────────────────

    deleteFile(relativePath: string): void {
        const fullPath = this._abs(relativePath);
        if (SysFile.Exists(fullPath)) SysFile.Delete(fullPath);
    }

    fileExists(relativePath: string): boolean {
        return SysFile.Exists(this._abs(relativePath));
    }

    // ── 目录操作 ──────────────────────────────────────────────────────────────

    ensureDir(relativeDirPath: string): void {
        SysDir.CreateDirectory(this._abs(relativeDirPath));
    }

    deleteDir(relativeDirPath: string): void {
        const fullPath = this._abs(relativeDirPath);
        if (SysDir.Exists(fullPath)) SysDir.Delete(fullPath, true);
    }

    listFiles(relativeDirPath: string): string[] {
        const fullPath = this._abs(relativeDirPath);
        if (!SysDir.Exists(fullPath)) return [];

        const csFiles = SysDir.GetFiles(fullPath);
        const result: string[] = [];
        for (let i = 0; i < csFiles.Length; i++) {
            result.push(SysPath.GetFileName(csFiles[i]));
        }
        return result;
    }

    listRootDirs(): string[] {
        if (!SysDir.Exists(this._root)) return [];

        const csDirs = SysDir.GetDirectories(this._root);
        const result: string[] = [];
        for (let i = 0; i < csDirs.Length; i++) {
            result.push(SysPath.GetFileName(csDirs[i]));
        }
        return result;
    }

    // ── 私有工具 ──────────────────────────────────────────────────────────────

    /** 将相对路径转换为绝对路径 */
    private _abs(relativePath: string): string {
        return SysPath.Combine(this._root, relativePath);
    }
}
