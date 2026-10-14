# Frontend Runtime Selection and Refactor Plan

## Product positioning

This frontend is for a local single-machine Agent workspace with LLM API integration. It is not a public SaaS, not a general-purpose browser, and not intended to browse arbitrary third-party websites.

The frontend is mainly driven by:

- Owned frontend code.
- Local AgentRuntime service APIs.
- User input.
- LLM responses.
- Runtime/tool/terminal output produced by local Agent workflows.

Security remains a baseline engineering hygiene concern, but the primary architecture drivers are reliability, foreground rendering performance, data correctness, and desktop lifecycle behavior.

## Non-negotiable frontend goals

### 1. Background/focus-loss correctness

When the frontend loses focus, is minimized, hidden, or otherwise in the background, the system must continue to work correctly:

- AgentRuntime must not be blocked by frontend event consumption.
- Background state must not cause frontend errors.
- The app must avoid unbounded buffering and memory growth.
- UI rendering can be paused or degraded when not visible.
- Returning to foreground must restore the correct state quickly.
- Backend state must remain authoritative for data that must survive frontend pauses, reloads, or disconnects.

### 2. Foreground high-performance realtime UI

When the frontend page/window is visible and actively being used:

- New assistant/user messages should render quickly.
- Terminal output should appear in near realtime.
- User input should stay responsive.
- Rendering should be minimal and scoped to necessary components.
- Unrelated panels must not re-render due to high-frequency events.
- UI must not stutter, flicker, or repeatedly rebuild stable DOM/xterm state.
- Memory should remain bounded and obsolete data should be cleaned.

## Core architectural conclusion

A normal browser tab is not the ideal final runtime container for this product because browser background behavior can throttle timers, pause animation frames, freeze JavaScript, or discard pages.

The recommended product shape is:

```text
AgentRuntime backend
  - Reliable execution
  - Required persistence
  - Runtime event hub
  - Snapshot/query APIs

Desktop shell
  - Window lifecycle
  - Backend startup/probing
  - Tray/minimize/exit behavior
  - Optional multi-window coordination

Web renderer
  - Foreground realtime UI
  - Minimal rendering
  - Recoverable synchronization
  - Background degradation
```

## Container selection plan

### Recommended primary POC: Electron

Electron should be validated first because this product is closer to an IDE/Agent workstation than a lightweight website.

Reasons:

- Built-in Chromium gives stable Web API compatibility.
- React/Vite/xterm.js/virtualized lists/workers are mature in Electron.
- Cross-platform behavior is more consistent than system-WebView-based stacks.
- Window lifecycle, tray, multi-window, and local process management are mature.
- It is proven for IDE-like products.

Tradeoff:

- Higher memory and package size.

### Secondary option: Tauri

Tauri is a strong lightweight alternative, especially because AgentRuntime is already a separate local backend.

Reasons:

- Smaller package and lower baseline resource usage.
- Good fit for Web renderer plus local sidecar service.

Tradeoff:

- Cross-platform WebView differences require more compatibility testing.

### Windows-only option: WebView2

WebView2 is strong if the product is Windows-only.

Reasons:

- Edge Chromium compatibility on Windows.
- Good integration with native Windows desktop shells.

Tradeoff:

- Not a cross-platform product path by itself.

## Container POC acceptance criteria

### Background and lifecycle

- Window blur while still visible does not degrade realtime rendering.
- Window minimize/hidden mode does not block AgentRuntime.
- Returning to foreground reconnects and resynchronizes correctly.
- System sleep/wake causes no unrecoverable frontend state.
- Closing/hiding behavior is explicit and predictable.

### Realtime UI

- SSE/EventSource works reliably in the shell.
- xterm.js renders high-frequency output smoothly.
- React UI remains responsive during large terminal output.
- No repeated full-page render is caused by terminal deltas.

### Backend integration

- Shell can start or probe AgentRuntime.
- Frontend can connect to local REST/SSE APIs.
- Backend restart/disconnect can be recovered by frontend.

## Runtime model refactor

### Principle: frontend is not the reliable event consumer

The frontend must not be required to consume every runtime event to preserve business correctness.

Correct responsibility split:

```text
Backend persistence/snapshot APIs = authoritative correctness
SSE/EventHub = foreground realtime acceleration and short reconnect replay
Frontend renderer = visible UI projection that can be rebuilt
```

### Foreground mode

When visible:

```text
SSE event
  -> lightweight dispatcher
  -> priority classification
  -> per-frame or short-window batching
  -> minimal store update / direct terminal flush
  -> scoped component render
```

### Background mode

When hidden/minimized:

```text
SSE event or disconnect
  -> no high-frequency UI render
  -> mark scene/terminal dirty
  -> keep bounded cursor/metadata only
  -> optionally close long-idle streams
  -> foreground return triggers authoritative resync
```

### Foreground recovery

When visible again:

```text
mark recovering
  -> reconnect stream with after_seq
  -> if replay is enough, continue realtime
  -> if gap or stale background, fetch snapshots
  -> hydrate ChatBubble/timeline/status/terminal state
  -> resume realtime flush
```

## P0 implementation areas

### 1. Page lifecycle foundation

Create a frontend lifecycle layer that tracks:

- focused
- visible but unfocused
- hidden/background
- recovering

Rules:

- Blur alone is not background.
- Hidden/minimized means background rendering should degrade.
- Visibility return triggers resync.

### 2. Event stream controller behavior

Move toward isolating SSE management from page rendering:

- Maintain per-scene seq cursor.
- Detect seq gaps.
- Avoid heavy work directly inside EventSource callbacks.
- Dispatch events by priority.
- Support background dirty-state tracking.
- Trigger resync when returning to foreground.

### 3. Terminal output pipeline

Terminal output is the highest-risk high-frequency path.

Target behavior:

```text
terminal.output.delta
  -> per-terminal buffer
  -> requestAnimationFrame or short interval flush while visible
  -> xterm.write incrementally
```

React state should keep low-frequency terminal metadata, not drive every output chunk through the entire page render path.

Background behavior:

- Do not write xterm while hidden.
- Do not accumulate unbounded terminal buffer.
- Mark terminal dirty.
- Restore from backend terminal snapshot on return when available.

### 4. Store selector and component render boundaries

Current risk: active scene state changes can cause broad ChatPage rerenders.

Target selector boundaries:

- Chat timeline selector.
- Terminal metadata/output selector.
- Composer selector.
- Runtime status/token selector.
- Scene tab selector.

Goal:

- Terminal output does not re-render message list.
- Composer input does not re-render terminal output.
- Token usage updates do not rebuild xterm state.

### 5. ChatBubble persistence queue

The UI may keep front-end-driven ChatBubble persistence, but it should not directly fire unlimited concurrent writes.

Target behavior:

- Small concurrency.
- Idempotent bubble identifiers.
- Timeout/retry.
- Failure logging.
- Best-effort flush during pagehide.
- Foreground reconcile with authoritative list.

## Backend/snapshot dependencies

Foreground recovery depends on authoritative APIs. Required or desired capabilities:

- List scene ChatBubbles.
- Current scene/root agent status.
- Pending interaction and pending user messages.
- Task/run status.
- Terminal session and terminal output snapshot.
- Token/context usage snapshot if needed.

EventHub should remain a realtime channel, not the only source of historical truth.

## Phased roadmap

### Phase 0: Baseline and documentation

- Save this plan.
- Define performance/recovery test scenarios.
- Confirm current frontend event and terminal bottlenecks.

### Phase 1: Electron POC

- Add minimal Electron shell in a separate path or package workspace.
- Load existing Vite frontend.
- Connect to local AgentRuntime.
- Validate SSE, xterm, minimize/restore, backend probing.
- Decide whether to continue Electron as primary container.

### Phase 2: Lifecycle-aware frontend foundation

- Add lifecycle state utilities/hooks.
- Distinguish visible/focused/background.
- Mark scenes dirty while hidden.
- Trigger resync on foreground return.

### Phase 3: Terminal high-performance channel

- Batch terminal deltas.
- Reduce React/Zustand updates caused by high-frequency output.
- Write incrementally to xterm while visible.
- Bound terminal memory and written chunk tracking.

### Phase 4: Minimal render boundaries

- Split ChatPage subscriptions/selectors.
- Isolate MessageList, TerminalPanel, Composer, TokenMeter updates.
- Add instrumentation if necessary to verify rerender reduction.

### Phase 5: Persistence and recovery robustness

- Queue ChatBubble persistence.
- Add timeout/retry/reconcile behavior.
- Strengthen gap/resync behavior.

### Phase 6: Desktop shell productization

- Formalize shell/backend startup and lifecycle.
- Define minimize-to-tray and quit behavior.
- Package frontend renderer.
- Keep browser dev mode for development.

## Suggested validation scenarios

### Realtime chat

- Send a user message.
- Assistant message appears within target latency.
- No visible flicker or scroll jump.

### High-frequency terminal output

- Produce 1,000 to 10,000 lines quickly.
- xterm remains responsive.
- Composer input remains usable.
- No sustained main-thread long tasks.
- Memory remains bounded.

### Background recovery

- Start a running Agent task.
- Hide/minimize app for 1 minute and 10 minutes.
- Continue backend work.
- Restore app.
- UI state is correct after resync.

### SSE replay and gap

- Disconnect event stream temporarily.
- Reconnect within replay window with after_seq.
- Force replay gap and verify snapshot resync.

### Multi-scene pressure

- Open multiple scenes.
- Run events in multiple scenes.
- Active scene remains smooth.
- Inactive scenes do not cause unnecessary foreground rendering.

## Target metrics

- Chat visible latency: ideally below 100ms.
- Terminal visible latency while foreground: ideally below 50-100ms.
- No sustained main-thread tasks above 50ms during normal output.
- Background CPU near idle when no foreground rendering is needed.
- Memory stable over long sessions.
- No unbounded raw event, terminal chunk, or written-id growth.

## Immediate execution priority

1. Save plan and baseline current frontend structure. ✅
2. Add lifecycle-aware foreground/background foundation. ✅
3. Reduce high-frequency terminal output pressure. ✅
4. Split rendering subscriptions and selectors. ✅
5. Add ChatBubble persistence queue. ✅
6. Start Electron POC once core frontend runtime model is clear enough to validate inside a shell. ✅

## Electron POC status

- `npm run electron:dev` starts Vite on `127.0.0.1:5173`, waits until the renderer responds, then opens Electron.
- `npm run electron:start` builds the renderer and opens Electron against the local `dist/` bundle through the `app://renderer/` protocol.
- The POC disables renderer background throttling for the BrowserWindow so foreground/background runtime behavior can be validated inside a desktop shell.
