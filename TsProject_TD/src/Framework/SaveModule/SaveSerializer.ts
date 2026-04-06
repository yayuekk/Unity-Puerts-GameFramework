/**
 * SaveSerializer — 序列化策略实现（Strategy Pattern）
 *
 * JsonSaveSerializer（默认实现）：
 *   - 使用 JSON.stringify 将数据序列化为 JSON 字符串
 *   - 存储层负责将字符串以 UTF-8 字节写入二进制 .sav 文件
 *   - 轻量、无外部依赖、跨平台，且调试时可直接用文本编辑器查看内容
 *
 * 替换示例（如需更紧凑的格式）：
 *   class MsgpackSerializer implements ISaveSerializer { ... }
 *   saveSystem.setSerializer(new MsgpackSerializer());
 */

import type { ISaveSerializer } from "./SaveTypes";

// ─── JsonSaveSerializer ────────────────────────────────────────────────────────

export class JsonSaveSerializer implements ISaveSerializer {

    private readonly _space: number | string | undefined;

    /**
     * @param space JSON 缩进量
     *   - 生产环境：传 undefined 或 0（紧凑格式，减小文件体积）
     *   - 开发调试：传 2（美化缩进，便于查看存档内容）
     */
    constructor(space?: number | string) {
        this._space = space;
    }

    serialize<T>(data: T): string {
        return JSON.stringify(data, null, this._space);
    }

    deserialize<T>(raw: string): T {
        return JSON.parse(raw) as T;
    }
}
