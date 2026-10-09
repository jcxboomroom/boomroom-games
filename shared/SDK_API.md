# BoomRoom HTML5 Game SDK API

This document defines the shared browser/WebView contract implemented by `boomroom-sdk.js`. The transport stays at protocol version 2; additive JavaScript APIs are at `apiRevision: 3`. Existing v2 games can keep their current calls while new or repaired games use the APIs below.

## Load and wait for the real room session

Load the shared SDK before the game code. Do not construct an online player, room, opponent, purchase receipt, or reward while the host session is still loading.

```html
<script src="../shared/boomroom-sdk.js?v=3"></script>
<script src="./game.js" defer></script>
```

`whenReady()` is the simplest asynchronous entry point. A session can already be ended when restored, so start a live round only after checking its status or subscribing to `onSessionStart`.

```js
const sdk = window.BoomRoomSDK;

sdk.onReady(session => renderRoomHeader(session));
sdk.onSessionStart(session => startRoundOnce(session.sessionId));
sdk.onGameEvent((eventName, payload, userId) => {
  handleRoomEvent({ eventName, payload, userId });
});

try {
  const session = await sdk.whenReady({ timeoutMs: 15000 });
  renderRoomHeader(session);
} catch (error) {
  showJoinError(error.code); // Keep a retry or return-to-room action visible.
}
```

`onBoomRoomSDKReady()` remains available for older games. It means the host supplied a valid session snapshot; it does not mean a socket is currently connected or that the game rules are server-verified. `onSessionStart()` represents a `PLAYING` session. Make round initialization idempotent by session ID so host retries or WebView restoration cannot start duplicate rounds.

## API surface

| API | Contract |
| --- | --- |
| `version`, `apiRevision` | `2` transport and additive API revision `3`. |
| `isReady`, `status`, `getStatus()` | Session-handshake and lifecycle state. States are `WAITING_FOR_SESSION`, `PLAYING`, `ENDED`, `ABORTED`, and `DISPOSED`. This is not a network-connectivity indicator. |
| `roomId`, `sessionId`, `gameSessionId`, `isHost` | Values from the authenticated host initialization. `sessionId` and `gameSessionId` are aliases. |
| `getUser()`, `getRoomPlayers()`, `roomPlayers` | Defensive copies of the signed-in game user and current room roster. No placeholder players are created. |
| `getSession()` | A copy of the latest canonical host/session snapshot. It is not proof that arbitrary game payloads are valid. |
| `getServerTime()` | Estimated server time from the last canonical snapshot plus a monotonic local clock. Use it for display/countdowns, not as an authority to settle a result. |
| `getCapabilities()` | Reports this SDK revision's transport features. `verifiedScoring` and `serverAuthoritativeRules` are false because the SDK itself does not implement a game's rules. |
| `isSessionCurrent(sessionId, minimumVersion = 1)` | Guards an async result against a replaced session or an older snapshot. |
| `sendGameEvent(eventName, payload)` | Sends an intent/event through the authenticated host. Returns `true` only when locally accepted by the transport, not when the game action was accepted by its rules. |
| `createCommand(kind, fields = {}, options = {})` | Builds `{...fields, kind, commandId, expectedVersion}` for versioned command engines. Returns `null` and reports an error if the session, fields, version, or secure UUID source is invalid. |
| `sendCommand(eventName, kind, fields = {}, options = {})` | Creates a versioned command and sends it as a game event. The server must still validate and deduplicate it. |
| `onReady(fn)`, `whenReady(options)` | Observe or await one real initialized session. `whenReady` rejects with `SDK_READY_TIMEOUT`, `SDK_WAIT_ABORTED`, or `SDK_DISPOSED` as appropriate. |
| `onSessionStart(fn)`, `onSessionUpdate(fn)`, `onSessionEnd(fn)` | Observe start, higher-version canonical snapshots, and end/abort transitions. `onSessionUpdate` receives `(current, previous)`. |
| `onStatusChange(fn)` | Immediately calls `fn(currentState, null)`, then calls it for lifecycle transitions with the prior state. It does not report network connection health. |
| `onGameEvent(fn)` | Receives `(eventName, payload, authenticatedSenderId)`. The sender ID is host-stamped; fields inside `payload` remain untrusted. |
| `onPlayerJoin(fn)`, `onPlayerLeave(fn)` | Observe roster membership changes. |
| `onRoomPlayersChange(fn)` | Receives `{ players, joined, left }` for one validated roster replacement. |
| `requestAdmission(itemId)` | Requests a host-checked admission/entry action without sending a client price. Wait for a correlated success/failure callback. |
| `requestPurchase(itemId, cost)` | Legacy purchase request. `cost` is a request hint only; the server must price from its own catalog and return a correlated receipt. |
| `onPurchaseSuccess(fn)`, `onPurchaseFailed(fn)` | Observe only a matching response for a pending request ID. A timeout is failure, never success. The APP must implement the v2 response bridge. |
| `completeRound(score)` | Reports a replayable round intent without ending the room session or claiming a reward. |
| `gameOver(...)`, `leaveGame()` | Legacy game-over intent and explicit exit request. Neither grants rewards. |
| `submitScore()`, `requestSettlement()` | Explicitly unsupported until a trusted scoring/settlement protocol is implemented; return `false` and emit an error. |
| `onError(fn)`, `dispose()` | Observe local SDK/transport errors and release subscriptions/timers. `pagehide` also disposes non-persisted pages. |

Every event subscription returns an unsubscribe function. Use it when a view, game mode, or component is removed. SDK snapshots are copies; mutating them does not update the host state.

## Versioned command example

This envelope works for official game engines that accept a matching `kind`, UUID `commandId`, and `expectedVersion`. The event name and `fields` are specific to the server contract for that game.

```js
const sent = sdk.sendCommand('GOMOKU_COMMAND', 'MOVE', {
  row: 4,
  col: 5,
}, {
  expectedVersion: sdk.getSession().version,
});

if (!sent) showLocalActionError('目前無法送出，請稍後重試');
```

`commandId` is a correlation/idempotency key, not an authorization token. The server must bind the command to its authenticated user, room instance, session, participant seat, legal game phase, and expected state version. It should deduplicate retries and return canonical state or a specific rejection. Do not trust client-supplied player IDs, roles, turn, board/cards, score, winner, price, or settlement.

For a responsive interface, show immediate *pending* feedback locally, then reconcile against the canonical state/receipt. Do not wait for a round-trip before drawing the tap/selection, and do not promote a prediction to the final game state before the authoritative response. If the transport has no per-action receipt, present a short pending/retry state and make the game mode's lower trust explicit.

## Select the right multiplayer model

The SDK is a shared connection and lifecycle layer, not a generic game server. It avoids writing a dedicated backend for every creator upload while keeping trust boundaries explicit.

1. **Local solo or practice.** The game may run offline without the BoomRoom session. Bots must be visibly labelled as AI. Local scores stay local and must not appear as verified rankings or coin rewards.
2. **Casual room event relay.** Use `sendGameEvent` for inputs, reactions, snapshots, and social play. The APP/server authenticate the sender and scope delivery to the live room/session and apply transport limits. They do not understand arbitrary HTML game rules. Treat every relayed payload and client-calculated result as unverified; do not award wallet currency or trusted ranked results from it.
3. **Hybrid prediction with a trusted referee.** Render movement and input immediately on the client; validate important transitions, hidden state, ranked outcomes, and rewards in a shared official engine. Return compact versioned snapshots and reconcile predictions. Implement this only where the game's trust or fairness needs justify it.
4. **Full real-time authority.** For games where collision, economy, hidden information, or competitive fairness must be protected, the server owns the rules and canonical state. A particular official game may need an engine, but this does not make a per-game engine a prerequisite for all creator HTML.

An APP host event such as `GOMOKU_STATE` or the seat-private `BLUFF_PRIVATE` may update the SDK's canonical session only when it arrives from the trusted host as a reserved `SYSTEM` event. Ordinary player events cannot refresh it. Adding another authoritative engine also requires the backend allowlist, authenticated command handler, durable state/transaction strategy where required, host forwarding rules, privacy checks, and server tests; adding JavaScript alone does not establish authority. Reserved events currently blocked from game-originated sends are `GOMOKU_STATE`, `GOMOKU_ERROR`, `BLUFF_PUBLIC`, `BLUFF_PRIVATE`, and `BLUFF_ERROR`.

## Compatibility and current limits

- Keep `version === 2` for the existing APP transport. `apiRevision === 3` is additive; do not change the transport version unless the Flutter host and all deployed clients are migrated together.
- Web messages are scoped to the parent frame and verified HTTP(S) origin. Native WebViews use the APP's current bridge. These checks protect the bridge boundary but are not a complete sandbox for untrusted HTML.
- The SDK has no `connected`/`reconnecting` signal because the current host contract does not forward a generic socket lifecycle event to HTML. `status` only describes session lifecycle.
- Generic relay events do not create canonical game snapshots. Only host-forwarded, explicitly recognized reserved events update the session today.
- The SDK does not provide game rules, deterministic RNG, rollback, anti-cheat, server-side scoring, matchmaking, persistent saves, or settlement. These are game/product or backend contracts, not promises of the transport layer.
- `sendGameEvent()` returning `true` means the local bridge accepted the send. A server ACK or game receipt is a separate event and must be designed by the game/backend.

## Local verification

The repository keeps tests and diagnostics local and ignores `test/` for source uploads. Run the game suite from `boomroom-games`:

```powershell
node --test test/*.test.cjs
```

This controlled message/clock suite checks SDK contracts but does not replace real-browser, native WebView, multi-device, network-loss, or actual human-play testing.
