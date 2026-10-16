import { DEFAULT_COOLDOWN_MINUTES, DEFAULT_WATCHDOG_IDLE_MS, getConfigPath, loadConfig, reindexAfterRemoval, updateConfig, } from "./config-store.js";
import { formatResetIn } from "./format-time.js";
let tuiModulePromise;
async function loadTuiModule() {
    tuiModulePromise ??= import("@earendil-works/pi-tui");
    try {
        return await tuiModulePromise;
    }
    catch {
        tuiModulePromise = undefined;
        return undefined;
    }
}
export function parsePositiveInteger(value, minimum) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed >= minimum ? parsed : undefined;
}
export function validateNewKey(config, name, key) {
    if (!name)
        return "Enter a name for the key.";
    if (!key)
        return "Enter the API key value.";
    if (config.keys.some((entry) => entry.key === key))
        return "That API key is already configured.";
    if (config.keys.some((entry) => entry.name === name))
        return "That name is already in use.";
    return undefined;
}
export function keyStatus(config, keyIndex, now) {
    const parts = [];
    if (keyIndex === config.activeKeyIndex)
        parts.push("active");
    const blockedUntil = quotaBlockedUntil(config, keyIndex, now);
    const cooldownStart = config.cooldowns[keyIndex];
    if (blockedUntil !== undefined) {
        parts.push(`quota-blocked ${formatResetIn(Math.ceil((blockedUntil - now) / 1000))}`);
    }
    else if (cooldownStart !== undefined) {
        const remaining = cooldownRemaining(config, cooldownStart, now);
        if (remaining > 0)
            parts.push(`cooldown ${Math.ceil(remaining / 60_000)}m`);
    }
    return parts.length === 0 ? "ready" : parts.join(" · ");
}
export function summarizeRestrictions(config, now) {
    let blocked = 0;
    let cooling = 0;
    for (let index = 0; index < config.keys.length; index++) {
        if (quotaBlockedUntil(config, index, now) !== undefined) {
            blocked++;
            continue;
        }
        const cooldownStart = config.cooldowns[index];
        if (cooldownStart !== undefined && cooldownRemaining(config, cooldownStart, now) > 0)
            cooling++;
    }
    if (blocked === 0 && cooling === 0)
        return "nothing to clear";
    return `${blocked} quota-blocked · ${cooling} cooling`;
}
export function selectKey(config, keyIndex) {
    if (config.keys[keyIndex] === undefined)
        return;
    config.activeKeyIndex = keyIndex;
    delete config.cooldowns[keyIndex];
    delete config.quotaBlockedUntil[keyIndex];
}
export function clearKeyRestrictions(config, keyIndex) {
    delete config.cooldowns[keyIndex];
    delete config.quotaBlockedUntil[keyIndex];
}
export function addKey(config, name, key) {
    config.keys.push({ name, key });
    if (config.keys.length === 1)
        config.activeKeyIndex = 0;
}
export function renameKey(config, keyIndex, name) {
    const entry = config.keys[keyIndex];
    if (entry)
        entry.name = name;
}
export function replaceKeySecret(config, keyIndex, key) {
    const entry = config.keys[keyIndex];
    if (entry)
        entry.key = key;
}
export function removeKey(config, keyIndex) {
    if (config.keys[keyIndex] === undefined)
        return;
    config.keys.splice(keyIndex, 1);
    config.cooldowns = reindexAfterRemoval(config.cooldowns, keyIndex);
    config.quotaBlockedUntil = reindexAfterRemoval(config.quotaBlockedUntil, keyIndex);
    if (keyIndex < config.activeKeyIndex)
        config.activeKeyIndex--;
    else if (config.activeKeyIndex >= config.keys.length)
        config.activeKeyIndex = 0;
}
export function clearAllRestrictions(config) {
    config.cooldowns = {};
    config.quotaBlockedUntil = {};
}
function quotaBlockedUntil(config, keyIndex, now) {
    const blockedUntil = config.quotaBlockedUntil[keyIndex];
    return typeof blockedUntil === "number" && Number.isFinite(blockedUntil) && blockedUntil > now ? blockedUntil : undefined;
}
function cooldownDurationMs(config) {
    return (config.cooldownMinutes || DEFAULT_COOLDOWN_MINUTES) * 60_000;
}
function cooldownRemaining(config, cooldownStart, now) {
    return Math.max(0, cooldownDurationMs(config) - (now - cooldownStart));
}
function watchdogIdleMs(config) {
    return config.watchdogIdleMs > 0 ? config.watchdogIdleMs : DEFAULT_WATCHDOG_IDLE_MS;
}
function rule(tui, theme) {
    return {
        render: (width) => [theme.fg("border", "─".repeat(Math.max(1, width)))],
        invalidate: () => { },
    };
}
function settingsTheme(theme) {
    return {
        label: (text, selected) => (selected ? theme.fg("accent", text) : text),
        value: (text) => {
            if (text === "on" || text === "active")
                return theme.fg("success", text);
            if (text.startsWith("quota-blocked"))
                return theme.fg("warning", text);
            if (text.startsWith("cooldown") || text === "off")
                return theme.fg("dim", text);
            return theme.fg("accent", text);
        },
        description: (text) => theme.fg("muted", text),
        cursor: theme.fg("accent", "> "),
        hint: (text) => theme.fg("dim", text),
    };
}
function selectTheme(theme) {
    return {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("muted", text),
    };
}
function createMenu(tui, theme, items, onSelect, onCancel) {
    const list = new tui.SelectList(items, Math.max(1, items.length), selectTheme(theme));
    list.onSelect = (item) => onSelect(item.value);
    list.onCancel = onCancel;
    return {
        render: (width) => list.render(width),
        invalidate: () => list.invalidate(),
        handleInput: (data) => list.handleInput(data),
    };
}
function createConfirm(tui, theme, message, onConfirm, onCancel) {
    return createMenu(tui, theme, [
        { value: "yes", label: "Yes", description: message },
        { value: "no", label: "No", description: "Keep the current state." },
    ], (value) => (value === "yes" ? onConfirm() : onCancel()), onCancel);
}
function createForm(tui, options) {
    const { theme, title, fields, isFocused, submit, cancel } = options;
    const inputs = fields.map((field) => {
        const input = new tui.Input({ placeholder: field.placeholder ?? "" });
        input.setValue(field.value ?? "");
        return input;
    });
    let focusIndex = 0;
    let error = "";
    const render = (width) => {
        const lines = [tui.truncateToWidth(theme.fg("accent", theme.bold(title)), width)];
        fields.forEach((field, index) => {
            const input = inputs[index];
            const selected = index === focusIndex;
            input.focused = isFocused() && selected;
            lines.push(tui.truncateToWidth(`${selected ? theme.fg("accent", "> ") : "  "}${theme.fg("muted", field.label)}`, width));
            lines.push(...input.render(Math.max(1, width - 2)).map((line) => tui.truncateToWidth(`  ${line}`, width)));
        });
        if (error)
            lines.push(tui.truncateToWidth(theme.fg("error", error), width));
        lines.push(tui.truncateToWidth(theme.fg("dim", "Tab or ↑/↓ switch · Enter submits · Esc cancels"), width));
        return lines;
    };
    const handleInput = (data) => {
        if (tui.matchesKey(data, "escape")) {
            cancel();
            return;
        }
        if (tui.matchesKey(data, "up") || tui.matchesKey(data, "shift+tab")) {
            focusIndex = (focusIndex + inputs.length - 1) % inputs.length;
            return;
        }
        if (tui.matchesKey(data, "down") || tui.matchesKey(data, "tab")) {
            focusIndex = (focusIndex + 1) % inputs.length;
            return;
        }
        if (tui.matchesKey(data, "return")) {
            error = submit(inputs.map((input) => input.getValue())) ?? "";
            return;
        }
        inputs[focusIndex].handleInput(data);
    };
    return {
        render,
        invalidate: () => {
            for (const input of inputs)
                input.invalidate();
        },
        handleInput,
    };
}
function createKeyManager(tui, options) {
    const { theme, config, keyIndex, isFocused, persist, rebuild, requestUsage, close } = options;
    const name = config.keys[keyIndex]?.name ?? `key-${keyIndex + 1}`;
    let form;
    let error = "";
    const finish = (selectId) => {
        close();
        rebuild(selectId);
    };
    const showError = (message) => {
        if (message === undefined)
            return false;
        error = message;
        return true;
    };
    const menu = createMenu(tui, theme, [
        { value: "use", label: "Set active", description: `Use "${name}" for the next request and clear its cooldown and quota block.` },
        { value: "rename", label: "Rename", description: `Rename "${name}".` },
        { value: "replace", label: "Replace key", description: "Store a new secret for this entry." },
        { value: "clear", label: "Clear restrictions", description: "Remove this key's cooldown and quota block." },
        { value: "usage", label: "Check usage", description: "Fetch plan usage for this key after the window closes." },
        { value: "remove", label: "Remove", description: `Delete "${name}" from the configuration.` },
        { value: "back", label: "Back", description: "Return to the key list." },
    ], (value) => {
        if (value === "use") {
            if (!showError(persist((fresh) => selectKey(fresh, keyIndex))))
                finish(`key:${keyIndex}`);
            return;
        }
        if (value === "clear") {
            if (!showError(persist((fresh) => clearKeyRestrictions(fresh, keyIndex))))
                finish(`key:${keyIndex}`);
            return;
        }
        if (value === "usage") {
            requestUsage(keyIndex);
            close();
            return;
        }
        if (value === "back") {
            close();
            return;
        }
        if (value === "rename") {
            form = createForm(tui, {
                theme,
                title: `Rename ${name}`,
                fields: [{ label: "Name", value: name }],
                isFocused,
                submit: (values) => {
                    const next = values[0].trim();
                    if (!next)
                        return "Enter a name.";
                    if (next !== name && config.keys.some((entry, index) => index !== keyIndex && entry.name === next)) {
                        return "That name is already in use.";
                    }
                    const saved = persist((fresh) => renameKey(fresh, keyIndex, next));
                    if (saved !== undefined)
                        return saved;
                    finish(`key:${keyIndex}`);
                    return undefined;
                },
                cancel: () => {
                    form = undefined;
                },
            });
            return;
        }
        if (value === "replace") {
            form = createForm(tui, {
                theme,
                title: `Replace ${name}`,
                fields: [{ label: "New API key", placeholder: "sk-..." }],
                isFocused,
                submit: (values) => {
                    const secret = values[0].trim();
                    if (!secret)
                        return "Enter the API key value.";
                    if (config.keys.some((entry, index) => index !== keyIndex && entry.key === secret)) {
                        return "That API key is already configured.";
                    }
                    const saved = persist((fresh) => replaceKeySecret(fresh, keyIndex, secret));
                    if (saved !== undefined)
                        return saved;
                    finish(`key:${keyIndex}`);
                    return undefined;
                },
                cancel: () => {
                    form = undefined;
                },
            });
            return;
        }
        form = createConfirm(tui, theme, `Delete "${name}"?`, () => {
            const saved = persist((fresh) => removeKey(fresh, keyIndex));
            if (saved !== undefined) {
                error = saved;
                form = undefined;
                return;
            }
            finish(keyIndex > 0 ? `key:${keyIndex - 1}` : undefined);
        }, () => {
            form = undefined;
        });
    }, () => close());
    const active = () => form ?? menu;
    return {
        render: (width) => [...active().render(width), ...(error ? [tui.truncateToWidth(theme.fg("error", error), width)] : [])],
        invalidate: () => active().invalidate?.(),
        handleInput: (data) => active().handleInput?.(data),
    };
}
export async function openOpencodeConfig(ctx) {
    if (ctx.mode !== "tui") {
        ctx.ui.notify("/opencode config requires interactive mode", "error");
        return {};
    }
    const tui = await loadTuiModule();
    if (!tui) {
        ctx.ui.notify("/opencode config is unavailable in this environment", "error");
        return {};
    }
    try {
        loadConfig();
    }
    catch (error) {
        ctx.ui.notify(`OpenCode config: ${error instanceof Error ? error.message : String(error)}`, "error");
        return {};
    }
    return await ctx.ui.custom((interactive, theme, _keybindings, done) => {
        const result = {};
        const status = new tui.Text(`Config file: ${getConfigPath()}`, 1, 0);
        const container = new tui.Container();
        let focused = false;
        let list;
        const isFocused = () => focused;
        const persist = (mutator) => {
            try {
                updateConfig(mutator);
                status.setText(theme.fg("dim", `Saved to ${getConfigPath()}`));
                return undefined;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                status.setText(theme.fg("error", `Save failed: ${message}`));
                return message;
            }
        };
        const buildItems = (current) => {
            const now = Date.now();
            const items = [];
            if (current.keys.length === 0) {
                items.push({
                    id: "empty",
                    label: "No keys configured",
                    currentValue: "none",
                    description: "Use Add key to register an OpenCode Go API key.",
                });
            }
            current.keys.forEach((entry, index) => {
                items.push({
                    id: `key:${index}`,
                    label: `${index + 1}. ${entry.name}`,
                    currentValue: keyStatus(current, index, now),
                    description: "Enter to set active, rename, replace, clear restrictions, check usage, or remove.",
                    submenu: (_value, close) => createKeyManager(tui, {
                        theme,
                        config: current,
                        keyIndex: index,
                        isFocused,
                        persist,
                        rebuild,
                        requestUsage: (keyIndex) => {
                            result.usageKeyIndex = keyIndex;
                        },
                        close: () => close(),
                    }),
                });
            });
            items.push({
                id: "add",
                label: "Add key",
                currentValue: "new",
                description: "Register another OpenCode Go API key.",
                submenu: (_value, close) => createForm(tui, {
                    theme,
                    title: "Add key",
                    fields: [
                        { label: "Name", placeholder: "personal" },
                        { label: "API key", placeholder: "sk-..." },
                    ],
                    isFocused,
                    submit: (values) => {
                        const name = values[0].trim();
                        const key = values[1].trim();
                        const validation = validateNewKey(current, name, key);
                        if (validation)
                            return validation;
                        let addedIndex;
                        const saved = persist((fresh) => {
                            addKey(fresh, name, key);
                            addedIndex = fresh.keys.length - 1;
                        });
                        if (saved)
                            return saved;
                        close();
                        rebuild(addedIndex === undefined ? undefined : `key:${addedIndex}`);
                        return undefined;
                    },
                    cancel: () => close(),
                }),
            });
            items.push({
                id: "cooldown",
                label: "Cooldown",
                currentValue: `${current.cooldownMinutes || DEFAULT_COOLDOWN_MINUTES} min`,
                description: "Rest period applied to a key after a transient rate limit.",
                submenu: (_value, close) => createForm(tui, {
                    theme,
                    title: "Cooldown",
                    fields: [{ label: "Minutes (at least 1)", value: String(current.cooldownMinutes || DEFAULT_COOLDOWN_MINUTES) }],
                    isFocused,
                    submit: (values) => {
                        const minutes = parsePositiveInteger(values[0], 1);
                        if (minutes === undefined)
                            return "Enter a whole number of at least 1.";
                        const saved = persist((fresh) => {
                            fresh.cooldownMinutes = minutes;
                        });
                        if (saved)
                            return saved;
                        close();
                        rebuild("cooldown");
                        return undefined;
                    },
                    cancel: () => close(),
                }),
            });
            items.push({
                id: "watchdog",
                label: "Watchdog",
                currentValue: current.watchdogEnabled ? "on" : "off",
                values: ["on", "off"],
                description: "Abort and rotate an opencode-go request that stalls with no response or stream activity.",
            });
            items.push({
                id: "watchdogIdle",
                label: "Watchdog idle",
                currentValue: `${Math.ceil(watchdogIdleMs(current) / 1000)}s`,
                description: "Seconds without activity before the watchdog declares a stall.",
                submenu: (_value, close) => createForm(tui, {
                    theme,
                    title: "Watchdog idle",
                    fields: [{ label: "Seconds (at least 1)", value: String(Math.ceil(watchdogIdleMs(current) / 1000)) }],
                    isFocused,
                    submit: (values) => {
                        const seconds = parsePositiveInteger(values[0], 1);
                        if (seconds === undefined)
                            return "Enter a whole number of at least 1.";
                        const saved = persist((fresh) => {
                            fresh.watchdogIdleMs = seconds * 1000;
                        });
                        if (saved)
                            return saved;
                        close();
                        rebuild("watchdogIdle");
                        return undefined;
                    },
                    cancel: () => close(),
                }),
            });
            items.push({
                id: "reset",
                label: "Reset blocks",
                currentValue: summarizeRestrictions(current, now),
                description: "Clear every cooldown and quota block.",
                submenu: (_value, close) => createConfirm(tui, theme, "Clear all cooldowns and quota blocks?", () => {
                    const saved = persist((fresh) => clearAllRestrictions(fresh));
                    close();
                    if (!saved)
                        rebuild("reset");
                }, () => close()),
            });
            return items;
        };
        const rebuild = (selectId) => {
            let current;
            try {
                current = loadConfig();
            }
            catch (error) {
                status.setText(theme.fg("error", `Reload failed: ${error instanceof Error ? error.message : String(error)}`));
                interactive.requestRender();
                return;
            }
            const items = buildItems(current);
            list = new tui.SettingsList(items, Math.max(1, Math.min(items.length, 12)), settingsTheme(theme), onChange, () => done(result));
            if (selectId)
                list.selectItem(selectId);
            container.clear();
            container.addChild(rule(tui, theme));
            container.addChild(new tui.Text(theme.fg("accent", theme.bold("OpenCode Go keys")), 1, 0));
            container.addChild(new tui.Text(theme.fg("dim", "Keys, cooldowns, quota blocks, and the stall watchdog. Esc closes."), 1, 0));
            container.addChild(list);
            container.addChild(status);
            container.addChild(rule(tui, theme));
            interactive.requestRender();
        };
        const onChange = (id, value) => {
            if (id !== "watchdog")
                return;
            const enabled = value === "on";
            if (persist((fresh) => {
                fresh.watchdogEnabled = enabled;
            }) === undefined) {
                rebuild("watchdog");
            }
        };
        rebuild();
        const component = {
            get focused() {
                return focused;
            },
            set focused(value) {
                focused = value;
            },
            render: (width) => container.render(width),
            invalidate: () => container.invalidate(),
            handleInput: (data) => {
                list.handleInput(data);
                interactive.requestRender();
            },
        };
        return component;
    }, { overlay: true, overlayOptions: { anchor: "center", width: "72%", minWidth: 60, maxHeight: "80%" } });
}
