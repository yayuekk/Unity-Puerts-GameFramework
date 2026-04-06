/**
 * SaveTypes — 存档系统公共类型定义
 *
 * 设计原则：
 *   - 仅包含对外暴露的接口与常量，与内部实现完全解耦
 *   - 依赖接口编程，便于 Mock 与单元测试
 *
 * 存档文件结构：
 *   {Application.persistentDataPath}/Saves/
 *     {ModuleName}/
 *       {FileName}.json   ← Dev 模式：明文 JSON，便于调试
 *       {FileName}.sav    ← Release 模式：UTF-8 二进制，不易直接阅读
 */

// ─── 存档模式 ──────────────────────────────────────────────────────────────────

/**
 * 存档模式。
 *
 * - Dev     : 开发阶段，生成 .json 明文文件，可直接用文本编辑器查看与修改
 * - Release : 发行阶段，生成 .sav 二进制文件（UTF-8 字节），不易直接阅读
 *
 * 切换模式时，若磁盘上已存在不同格式的存档，系统会自动清除旧存档。
 */
export const SaveMode = {
    Dev:     "dev",
    Release: "release",
} as const;
export type SaveMode = typeof SaveMode[keyof typeof SaveMode];

/** 各存档模式对应的文件扩展名 */
export const SAVE_MODE_EXT: Readonly<Record<SaveMode, string>> = {
    dev:     ".json",
    release: ".sav",
};

// ─── 存档标识 ──────────────────────────────────────────────────────────────────

/** 存档唯一标识：模块名 + 文件名的组合 */
export interface SaveKey {
    readonly moduleName: string;
    readonly fileName:   string;
}

/** Release 模式下的默认存档文件扩展名（向后兼容保留） */
export const SAVE_FILE_EXT = SAVE_MODE_EXT[SaveMode.Release];

// ─── 序列化策略接口（Strategy Pattern） ───────────────────────────────────────

/**
 * 序列化策略接口。
 *
 * 职责：负责数据对象与字符串载体之间的双向转换。
 * 存储层负责将字符串写入文件（Dev 模式为明文，Release 模式为二进制字节），
 * 与序列化策略完全解耦。
 *
 * 默认实现：JsonSaveSerializer（JSON 格式）
 * 可替换为 MessagePack、Protocol Buffers 等任意格式。
 */
export interface ISaveSerializer {
    /** 将数据对象序列化为字符串 */
    serialize<T>(data: T): string;
    /** 将字符串反序列化为数据对象 */
    deserialize<T>(raw: string): T;
}

// ─── 存储适配器接口（Adapter Pattern） ────────────────────────────────────────

/**
 * 平台存储适配器接口。
 *
 * 职责：屏蔽底层文件 IO 差异，提供统一的字符串读写入口。
 * Dev 模式：使用 WriteAllText 写入明文；Release 模式：使用 WriteAllBytes 写二进制。
 *
 * 所有 relativePath / dirPath 均为相对于 rootPath 的路径。
 *
 * 默认实现：PlatformSaveStorage（基于 System.IO，支持 PC / Android / iOS）
 */
export interface ISaveStorage {
    /** 存档根目录绝对路径 */
    readonly rootPath: string;

    /** 将字符串写入文件（具体格式由实现决定；目录不存在则自动创建） */
    write(relativePath: string, content: string): void;

    /** 读取文件为字符串，文件不存在时返回 null */
    read(relativePath: string): string | null;

    /** 删除文件，文件不存在时静默忽略 */
    deleteFile(relativePath: string): void;

    /** 判断文件是否存在 */
    fileExists(relativePath: string): boolean;

    /** 确保目录存在（不存在则递归创建） */
    ensureDir(relativeDirPath: string): void;

    /** 删除目录及其所有内容，目录不存在时静默忽略 */
    deleteDir(relativeDirPath: string): void;

    /** 列出目录下所有文件名（含扩展名），目录不存在时返回空数组 */
    listFiles(relativeDirPath: string): string[];

    /** 列出存档根目录下所有子目录名，根目录不存在时返回空数组 */
    listRootDirs(): string[];
}

// ─── 存档句柄接口 ──────────────────────────────────────────────────────────────

/**
 * 单个存档文件的类型化操作句柄。
 *
 * 轻量对象，不持有数据缓存，每次 load / save 均直接触发 IO。
 * 通过 ISaveModule.getHandle<T>(fileName) 获取。
 */
export interface ISaveHandle<T> {
    /** 存档唯一标识（模块名 + 文件名） */
    readonly key: SaveKey;

    /** 判断此存档文件是否存在 */
    exists(): boolean;

    /**
     * 加载并反序列化存档数据。
     * 文件不存在或反序列化失败时返回 undefined。
     */
    load(): T | undefined;

    /**
     * 序列化并保存存档数据。
     * 序列化失败时抛出异常。
     */
    save(data: T): void;

    /** 删除此存档文件，不存在时静默忽略 */
    delete(): void;
}

// ─── 模块存档接口 ──────────────────────────────────────────────────────────────

/**
 * 模块存档句柄，管理某个逻辑模块下所有存档文件。
 *
 * 对应文件系统结构：{rootPath}/{moduleName}/
 * 通过 ISaveSystem.getModule(moduleName) 获取。
 */
export interface ISaveModule {
    /** 模块名称（对应存档子目录名） */
    readonly moduleName: string;

    /** 列出当前模块下所有存档的文件名（不含扩展名） */
    listSaves(): string[];

    /**
     * 获取指定文件名的类型化存档句柄（轻量工厂方法，不触发 IO）。
     * @param fileName 存档文件名，不含扩展名（如 "slot_0"、"chapter_01"）
     */
    getHandle<T>(fileName: string): ISaveHandle<T>;

    /** 删除指定存档文件，不存在时静默忽略 */
    deleteSave(fileName: string): void;

    /** 清空该模块下所有存档文件（保留模块目录） */
    clearAll(): void;
}

// ─── 存档系统接口 ──────────────────────────────────────────────────────────────

/**
 * 存档系统公共接口（面向接口编程，便于 Mock / 替换实现）。
 *
 * 文件结构示例（Dev 模式）：
 *   {persistentDataPath}/Saves/
 *     Player/
 *       slot_0.json       ← 明文，可直接阅读
 *
 * 文件结构示例（Release 模式）：
 *   {persistentDataPath}/Saves/
 *     Player/
 *       slot_0.sav        ← 二进制，不易直接阅读
 *
 * 使用示例：
 * ```ts
 * const save = framework.getModule<ISaveSystem>("SaveSystem");
 * const handle = save.getModule("Player").getHandle<PlayerData>("slot_0");
 * handle.save({ level: 10, hp: 100 });
 * const data = handle.load(); // PlayerData | undefined
 * ```
 */
export interface ISaveSystem {
    /** 当前存档模式（Dev / Release） */
    readonly mode: SaveMode;

    /** 当前使用的序列化策略 */
    readonly serializer: ISaveSerializer;

    /**
     * 获取指定模块的存档句柄。
     * 模块目录不存在时自动创建，同一模块名始终返回缓存的同一实例。
     */
    getModule(moduleName: string): ISaveModule;

    /**
     * 清除整个模块目录及其所有存档文件。
     * 目录不存在时静默忽略。
     */
    clearModule(moduleName: string): void;

    /** 列出存档根目录下所有已存在的模块名 */
    listModules(): string[];
}
