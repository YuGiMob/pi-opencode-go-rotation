import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeConfig, type Config } from "../src/config-store.ts";
import {
	addKey,
	clearAllRestrictions,
	clearKeyRestrictions,
	keyStatus,
	openOpencodeConfig,
	parsePositiveInteger,
	removeKey,
	renameKey,
	replaceKeySecret,
	selectKey,
	summarizeRestrictions,
	validateNewKey,
} from "../src/config-ui.ts";

function fixture(): Config {
	return {
		keys: [
			{ name: "one", key: "sk-one" },
			{ name: "two", key: "sk-two" },
			{ name: "three", key: "sk-three" },
		],
		activeKeyIndex: 0,
		cooldownMinutes: 60,
		watchdogEnabled: true,
		watchdogIdleMs: 90_000,
		cooldowns: {},
		quotaBlockedUntil: {},
		authImportDeclined: false,
	};
}

let tempConfigQueue = Promise.resolve();

async function withTempConfig(run: (path: string) => Promise<void>): Promise<void> {
	const previousQueue = tempConfigQueue;
	let release: () => void = () => {};
	tempConfigQueue = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previousQueue;
	const directory = mkdtempSync(join(tmpdir(), "opencode-config-ui-test-"));
	const path = join(directory, "opencode-keys.json");
	const previousPath = process.env.PI_OPENCODE_ROTATION_CONFIG;
	process.env.PI_OPENCODE_ROTATION_CONFIG = path;
	writeConfig(fixture(), path);
	try {
		await run(path);
	} finally {
		if (previousPath === undefined) delete process.env.PI_OPENCODE_ROTATION_CONFIG;
		else process.env.PI_OPENCODE_ROTATION_CONFIG = previousPath;
		rmSync(directory, { recursive: true, force: true });
		release();
	}
}

test("parsePositiveInteger requires whole numbers at or above the minimum", () => {
	assert.equal(parsePositiveInteger("5", 1), 5);
	assert.equal(parsePositiveInteger(" 12 ", 1), 12);
	assert.equal(parsePositiveInteger("0", 1), undefined);
	assert.equal(parsePositiveInteger("1.5", 1), undefined);
	assert.equal(parsePositiveInteger("abc", 1), undefined);
});

test("validateNewKey rejects empty values, duplicate secrets, and duplicate names", () => {
	const config = fixture();
	assert.equal(validateNewKey(config, "", "sk-new"), "Enter a name for the key.");
	assert.equal(validateNewKey(config, "fresh", ""), "Enter the API key value.");
	assert.equal(validateNewKey(config, "fresh", "sk-one"), "That API key is already configured.");
	assert.equal(validateNewKey(config, "one", "sk-fresh"), "That name is already in use.");
	assert.equal(validateNewKey(config, "fresh", "sk-fresh"), undefined);
});

test("keyStatus reports active, cooldown, quota-blocked, and ready keys", () => {
	const config = fixture();
	config.cooldowns[1] = 0;
	config.quotaBlockedUntil[2] = 120_000;
	assert.equal(keyStatus(config, 0, 0), "active");
	assert.equal(keyStatus(config, 1, 0), "cooldown 60m");
	assert.equal(keyStatus(config, 2, 0), "quota-blocked 2m");
	assert.equal(keyStatus(fixture(), 1, 0), "ready");
});

test("summarizeRestrictions counts quota blocks and cooling keys", () => {
	const config = fixture();
	config.quotaBlockedUntil[0] = 60_000;
	config.cooldowns[1] = 0;
	assert.equal(summarizeRestrictions(config, 0), "1 quota-blocked · 1 cooling");
	assert.equal(summarizeRestrictions(fixture(), 0), "nothing to clear");
});

test("selectKey activates the target and clears its restrictions", () => {
	const config = fixture();
	config.cooldowns[1] = 5;
	config.quotaBlockedUntil[1] = 60_000;
	selectKey(config, 1);
	assert.equal(config.activeKeyIndex, 1);
	assert.deepEqual(config.cooldowns, {});
	assert.deepEqual(config.quotaBlockedUntil, {});
});

test("clearKeyRestrictions only touches the target key", () => {
	const config = fixture();
	config.cooldowns[0] = 5;
	config.cooldowns[1] = 5;
	config.quotaBlockedUntil[1] = 60_000;
	config.quotaBlockedUntil[2] = 60_000;
	clearKeyRestrictions(config, 1);
	assert.deepEqual(config.cooldowns, { 0: 5 });
	assert.deepEqual(config.quotaBlockedUntil, { 2: 60_000 });
});

test("addKey activates the first key and keeps later adds inactive", () => {
	const config = fixture();
	config.keys = [];
	config.activeKeyIndex = 0;
	addKey(config, "first", "sk-first");
	assert.equal(config.activeKeyIndex, 0);
	addKey(config, "second", "sk-second");
	assert.equal(config.activeKeyIndex, 0);
	assert.deepEqual(config.keys.map((entry) => entry.name), ["first", "second"]);
});

test("renameKey and replaceKeySecret update only the target entry", () => {
	const config = fixture();
	renameKey(config, 1, "renamed");
	replaceKeySecret(config, 1, "sk-new");
	assert.equal(config.keys[1].name, "renamed");
	assert.equal(config.keys[1].key, "sk-new");
	assert.equal(config.keys[0].name, "one");
});

test("removeKey reindexes maps and repairs the active index", () => {
	const config = fixture();
	config.cooldowns = { 0: 10, 1: 20, 2: 30 };
	config.quotaBlockedUntil = { 0: 100, 1: 200, 2: 300 };
	config.activeKeyIndex = 2;
	removeKey(config, 1);
	assert.deepEqual(config.keys.map((entry) => entry.name), ["one", "three"]);
	assert.deepEqual(config.cooldowns, { 0: 10, 1: 30 });
	assert.deepEqual(config.quotaBlockedUntil, { 0: 100, 1: 300 });
	assert.equal(config.activeKeyIndex, 1);
});

test("clearAllRestrictions empties both maps", () => {
	const config = fixture();
	config.cooldowns = { 0: 1 };
	config.quotaBlockedUntil = { 1: 2 };
	clearAllRestrictions(config);
	assert.deepEqual(config.cooldowns, {});
	assert.deepEqual(config.quotaBlockedUntil, {});
});

test("openOpencodeConfig requires interactive mode", async () => {
	const notifications: string[] = [];
	await openOpencodeConfig({
		mode: "json",
		ui: {
			notify: (message: string) => {
				notifications.push(message);
			},
		},
	} as unknown as Parameters<typeof openOpencodeConfig>[0]);
	assert.match(notifications[0] ?? "", /requires interactive mode/);
});

test("openOpencodeConfig reports an unreadable config", async () => {
	await withTempConfig(async (path) => {
		writeFileSync(path, "{ invalid json\n", { mode: 0o600 });
		const notifications: string[] = [];
		await openOpencodeConfig({
			mode: "tui",
			ui: {
				notify: (message: string) => {
					notifications.push(message);
				},
			},
		} as unknown as Parameters<typeof openOpencodeConfig>[0]);
		assert.match(notifications[0] ?? "", /OpenCode config:/);
	});
});

test("openOpencodeConfig renders the key manager in TUI mode", async () => {
	await withTempConfig(async () => {
		let rendered = "";
		let notified = 0;
		await openOpencodeConfig({
			mode: "tui",
			ui: {
				notify: () => {
					notified++;
				},
				custom: async (factory: unknown) => {
					const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
					const create = factory as (
						interactive: unknown,
						theme: unknown,
						keybindings: unknown,
						done: (result: unknown) => void,
					) => { render(width: number): string[] };
					const component = create({ requestRender: () => {} }, theme, {}, () => {});
					rendered = component.render(80).join("\n");
					return undefined;
				},
			},
		} as unknown as Parameters<typeof openOpencodeConfig>[0]);
		assert.match(rendered, /1\. one/);
		assert.match(rendered, /2\. two/);
		assert.match(rendered, /3\. three/);
		assert.match(rendered, /Add key/);
		assert.match(rendered, /Cooldown/);
		assert.match(rendered, /Watchdog/);
		assert.equal(notified, 0);
	});
});
