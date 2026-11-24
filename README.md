# pi-opencode-go-rotation

Rotate between multiple OpenCode Go API keys. The extension checks OpenCode Go usage when a 429 response arrives, rotates around quota-blocked keys, and aborts silent stalls detected by the watchdog. Automatic rotation is policy-gated and defaults to `quota-only`: it switches keys only when usage proves an exhausted window or a quota error carries a parseable reset.

Fork of [lnilluv/pi-opencode-go-rotation](https://github.com/lnilluv/pi-opencode-go-rotation). This fork adds a live footer status line for the active key's OpenCode Go usage.

## Install

```bash
pi install npm:@yugimob/pi-opencode-go-rotation
```

## Setup

Add your API keys:

```
/opencode add personal sk-xxxx
/opencode add work sk-yyyy
/opencode add backup sk-zzzz
```

The first key added becomes active immediately.

If `OPENCODE_API_KEY` is set in the environment and no keys are configured, the extension recognizes it as an unmanaged `env` key: it reports that key's usage and keeps the footer working, but never writes it to the config file. Pi already uses that variable for its own requests, so nothing changes about how the model is called. `/opencode add` stores a managed copy that participates in rotation.

The extension never imports keys from `auth.json` automatically. When no keys are configured, it observes the credential pi resolves from `auth.json` as an unmanaged `auth` key, so status, usage, and the footer work without writing it to the config file. It does not participate in rotation until imported.

`/opencode` offers to import the `auth.json` key once. Declining is remembered, and the observed `auth` key keeps working. Run `/opencode import` to import it later without the prompt.

## Interactive key manager

In interactive mode, `/opencode` (or `/opencode config`) opens the key manager overlay. It lists every key with its active, cooldown, or quota-blocked state, and lets you:

- Activate a key and clear its cooldown and quota block
- Rename a key or replace its secret
- Remove a key
- Add a key without remembering the command syntax
- Check a key's usage after the window closes
- Change the cooldown duration, the rotation policy, candidate verification, and the watchdog settings
- Clear every cooldown and quota block

Changes are saved as soon as they are confirmed. Outside interactive mode the command prints the text status instead.

## How it works

The extension sets the active key as a runtime override, which takes priority over `OPENCODE_API_KEY` environment variables and `auth.json` credentials. When no keys are configured, the environment key and an `auth.json` credential are only observed (as `env` and `auth`) and never overridden or persisted.

Automatic rotation is governed by `rotationPolicy`:

| Policy | Rotates when |
|--------|--------------|
| `off` | Never automatically. Usage checks still report and manual `/opencode next` and `/opencode use <n>` still switch. |
| `quota-only` (default) | OpenCode Go usage confirms an exhausted window, or a fixed-window quota error carries a parseable reset. |
| `full` | Also on transient rate limits and on watchdog stalls. |

Candidate verification is a separate switch (`verifyCandidates`, default `false`). When enabled, each candidate key's usage is checked before switching to it; when disabled, the next key is chosen from configuration state without sending its key to the usage endpoint. The active key is still checked when it reports a 429 or a quota error, and `/opencode usage` still works on demand.

The extension has three recovery paths:

1. **Usage-verified Go quota exhaustion**: when OpenCode Go returns HTTP 429, the extension sends the active key only to `https://opencode.ai/zen/go/v1/usage`. A key with a `rate-limited` window or a window at 100% is blocked until the latest reported reset, and the next candidate is activated. With `verifyCandidates` enabled, candidate keys are checked the same way before they are selected, so an exhausted key is blocked and skipped instead of being tried. Rotation prefers keys outside transient cooldown, but can clear a cooldown rather than keep using an exhausted key. When every key is quota-blocked, rotation stops and reports the earliest reset instead of cycling.
2. **Transient limit errors** (`full` only): when the usage endpoint is unavailable, does not report an exhausted window, or does not finish within 10 seconds, the extension aborts a timed-out usage request, marks the current key as on cooldown, and switches to the next key that is not quota-blocked. Under `quota-only` and `off` the key stays active and the extension reports the limit instead of rotating.
3. **Silent stalls**: when an `opencode-go` provider request has no response or stream activity for the watchdog window, the extension aborts the hung turn and, after the run settles, automatically restarts the request through a hidden continuation message. There is no retry cap: every stall schedules another continuation. It rotates under `full`; otherwise the continuation uses the same key. Setting `retry.enabled: false` in pi's settings also disables the continuation.

Checks happen at decision points only: a candidate is verified when `verifyCandidates` is enabled and it is about to be selected, and a key with a recorded block is left alone until its stored reset passes. Normal requests are not pre-checked. With the interactive footer active, the periodic footer refresh also re-checks the active key and, unless `rotationPolicy` is `off`, records a block if a window is full, so the next request can rotate before it fails.

Fixed-window Go plan quota errors reported at message end follow the same policy: a parseable reset timestamp is authoritative; without one, `quota-only` and `off` record the cooldown-length block without rotating, and `full` rotates. A response-hook rotation is deduplicated so the matching message-end error cannot rotate twice.

Rotations driven by a 429 or a response hook rely on pi's built-in auto-retry and its `retry.maxRetries`. A watchdog abort cannot use that retry because pi skips aborted runs, so the extension schedules its own continuation, with no cap.

Cooldowns default to 60 minutes. Quota blocks expire at their persisted deadline. Manual `/opencode use <n>` and `/opencode next` clear both restrictions on the selected key.

Usage commands use `https://opencode.ai/zen/go/v1/usage` and stop waiting after 10 seconds. A timeout reports `Usage request timed out after 10s.`.

## Footer usage

While the selected model uses the `opencode-go` provider, the extension keeps a status line in pi's footer with the active key's name, the weekly and monthly usage windows, and the monthly renewal date:

```text
personal: wk 40% · mo 55% | ↻ Nov 12
```
The rolling 5-hour window is omitted from the footer.

It refreshes on session start, model changes, turns, key rotations, manual key commands, and every 5 minutes. Under `quota-only` and `full`, a window at 100% or rate-limited blocks the active key until the window's reset and the next request moves to another key; under `off` the footer reports the window without changing keys. The key name — or `env`/`auth` for an unmanaged key — leads the line, and switching to another provider clears it.

Running `/opencode footer off` or setting `footerUsageEnabled` to `false` hides the line and stops the periodic refresh, including its pre-emptive quota blocking. `/opencode usage` still fetches usage on demand.

## Commands

| Command | Description |
|---------|-------------|
| `/opencode` or `/opencode config` | Open the interactive key manager |
| `/opencode status` | Show all keys, active key marker, cooldown and quota-blocked status, or the unmanaged `env`/`auth` key when no managed keys are configured |
| `/opencode usage` or `/opencode quota` | Fetch OpenCode Go usage for the active key without showing key material |
| `/opencode use <n>` | Switch to key number `n` (1-based) and clear its cooldown and quota block |
| `/opencode next` | Advance to the next configured key and clear its cooldown and quota block before activating it |
| `/opencode add <name> <key>` | Add a new key |
| `/opencode import` | Import the `auth.json` key into the config even after a declined prompt |
| `/opencode rm <n>` | Remove key number `n` |
| `/opencode reset` | Clear all cooldowns and quota blocks |
| `/opencode cooldown <min>` | Set or view cooldown duration in minutes |
| `/opencode policy [off\|quota-only\|full]` | Set or view the automatic rotation policy |
| `/opencode verify <on\|off>` | Enable or disable candidate usage verification before switching |
| `/opencode footer [on\|off]` | Show or change the footer usage line |
| `/opencode events` | Show recent watchdog timeout history (last 10) |
| `/opencode watchdog [status\|on\|off\|<seconds>]` | Configure silent-stall detection |

## Configuration

Keys are stored in `~/.pi/agent/opencode-keys.json` with file permissions `0600`. Status output shows key names only; it does not display key material.

```json
{
  "keys": [
    { "name": "personal", "key": "sk-xxx" },
    { "name": "work", "key": "sk-yyy" }
  ],
  "activeKeyIndex": 0,
  "cooldownMinutes": 60,
  "watchdogEnabled": true,
  "watchdogIdleMs": 300000,
  "rotationPolicy": "quota-only",
  "verifyCandidates": false,
  "footerUsageEnabled": true,
  "cooldowns": {},
  "quotaBlockedUntil": {},
  "authImportDeclined": false
}
```

### Retry settings

Pair with pi's auto-retry for best results. In `~/.pi/agent/settings.json`:

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3
  }
}
```

Set `maxRetries` to at least the number of keys so all keys get a chance before pi gives up. This applies to 429 and response-hook rotations. The watchdog continuation ignores `maxRetries` and has no cap, so it keeps restarting a silent stall; `retry.enabled: false` turns it off.

## Limitations

- The watchdog is scoped to the `opencode-go` provider only. Other providers are not aborted, and the watchdog rotates only under `rotationPolicy` `full`.
- The watchdog defaults to a 5-minute idle window. A legitimate long-running request with no stream activity can be treated as stalled and aborted; tune with `/opencode watchdog <seconds>` or disable with `/opencode watchdog off`.
- Under `quota-only`, a bare 429, an HTTP 401, an unconfirmed usage result, and a watchdog stall never switch keys; the extension reports them and leaves the active key in place. `full` restores the earlier behavior.
- When all non-quota-blocked keys are transiently cooling down (`full` only), the extension may clear the next eligible key's cooldown. It never automatically clears or force-selects a quota-blocked key.
- When all keys are quota-blocked, automatic rotation stops on the current runtime key; each key becomes eligible again automatically when its stored reset deadline passes, or immediately after `/opencode reset`.
- Recorded blocks are never re-probed before their stored reset, so there is no plan-top-up recovery; use `/opencode reset` or `/opencode use <n>` to clear a block early.
- Go plan usage limits are tied to the subscription workspace; multiple keys from one workspace should not be assumed to provide independent quota. See the [OpenCode Go documentation](https://opencode.ai/docs/go/).
- Keys added via `/opencode add` are stored in plaintext. The config file is created and maintained with `0600` permissions.
- An unmanaged `env` or `auth` key is never stored, so it cannot rotate and is not remembered as a managed key; `/opencode add` stores a managed copy, and `/opencode import` stores the `auth.json` credential. A stored `auth.json` credential takes precedence over the environment variable, and the extension follows the credential pi resolves.

## License

MIT
