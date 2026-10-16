import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type Config } from "./config-store.ts";
export interface OpencodeConfigResult {
    usageKeyIndex?: number;
}
export declare function parsePositiveInteger(value: string, minimum: number): number | undefined;
export declare function validateNewKey(config: Config, name: string, key: string): string | undefined;
export declare function keyStatus(config: Config, keyIndex: number, now: number): string;
export declare function summarizeRestrictions(config: Config, now: number): string;
export declare function selectKey(config: Config, keyIndex: number): void;
export declare function clearKeyRestrictions(config: Config, keyIndex: number): void;
export declare function addKey(config: Config, name: string, key: string): void;
export declare function renameKey(config: Config, keyIndex: number, name: string): void;
export declare function replaceKeySecret(config: Config, keyIndex: number, key: string): void;
export declare function removeKey(config: Config, keyIndex: number): void;
export declare function clearAllRestrictions(config: Config): void;
export declare function openOpencodeConfig(ctx: Pick<ExtensionCommandContext, "mode" | "ui">): Promise<OpencodeConfigResult>;
