# BoomRoom HTML5 Game SDK API

This document defines the shared browser/WebView contract implemented by `boomroom-sdk.js`. The transport stays at protocol version 2; additive JavaScript APIs are at `apiRevision: 8`. Existing v2 games can keep their current calls while new or repaired games use the APIs below.

> **Game-development prerequisite:** Read [`WAGERING_RULES.md`](WAGERING_RULES.md) before designing, integrating, or repairing any BoomRoom game. Admission and voluntary wagers are separate. Revision 8 exposes common wager proposals and consent; the backend opens this only for registered official rules. Creator uploads remain unverified and cannot enable paid wagering by sending scores or setting their own capabilities.

## Load and wait for the real room session

Revision 8 uses `sdk.isSpectator` and `session.spectatorSupported`. A host-provided `isSpectator: true` with `viewerRole: 'spectator'` allows a room member to read public official-game state. This page role is immutable. The SDK permits local tools, haptic and leave requests and rejects game intents, purchases, admission and completion with `SPECTATOR_READ_ONLY`. The backend independently authenticates room membership and projects public state.

Only `SYSTEM / TETRIS_SPECTATOR` or `SYSTEM / GAME_SPECTATOR` can refresh a spectator page. Game 36 uses `digits-v1` packed boards. Other games use their official public projection. Private cards, unrevealed dice, answers, crash times and engine randomness are hidden. Eliminated players retain their page and can choose another public viewpoint. A player who returns to the room can open a separate read-only spectator page without another admission charge.

Load the shared SDK before the game code. Do not construct an online player, room, opponent, purchase receipt, or reward while the host session is still loading.

```html
<script src="../shared/boomroom-sdk.js?v=8"></script>
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
| `version`, `apiRevision` | `2` transport and additive API revision `8`. |
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
| `haptic(style = 'light')` | Best-effort local feedback: `selection`, `light`, `medium`, `heavy`. Requires a live session; requests are limited to one per 50 ms. Uses browser vibration where available, otherwise sends a session-bound request to the updated APP's Flutter `HapticFeedback` bridge for Android/iOS. `true` means accepted locally, not that hardware vibrated. Older APP hosts ignore this additive request. |
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

An APP host event such as `GOMOKU_STATE` or the seat-private `BLUFF_PRIVATE` may update the SDK's canonical session only when it arrives from the trusted host as a reserved `SYSTEM` event. Ordinary player events cannot refresh it. Adding another authoritative engine also requires the backend allowlist, authenticated command handler, durable state/transaction strategy where required, host forwarding rules, privacy checks, and server tests; adding JavaScript alone does not establish authority. Reserved events blocked from game-originated sends are `GOMOKU_STATE`, `GOMOKU_ERROR`, `BLUFF_PUBLIC`, `BLUFF_PRIVATE`, `BLUFF_ERROR`, `TETRIS_PRIVATE`, `TETRIS_ERROR`, `TETRIS_STATE`, and `TETRIS_QUEUED`.

## Compatibility and current limits

- Keep `version === 2` for the existing APP transport. `apiRevision === 8` is additive; do not change the transport version unless the Flutter host and all deployed clients are migrated together.
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


## Tetris Battle 權威擴充（revision 5）

第 36 款可加碼，依 WAGERING_RULES 與其 README 完成伺服器投票、全員確認、錢包原子交易及排名分池。TETRIS_PRIVATE 僅由 SYSTEM 送至本人座位，包含同一 Session 的個人棋盤、ack、本人餘額、投票與派彩收據；SDK 會核對本人 userId 及非倒退版本。TETRIS_PRIVATE／TETRIS_ERROR／TETRIS_STATE／TETRIS_QUEUED 均為保留事件。TETRIS_COMMAND 的操作意圖由後端專屬引擎驗證；通用 SDK 的 verifiedScoring／serverAuthoritativeRules 能力仍為 false，不能將此特定遊戲的權威能力套用到其他 UGC。新版後端與 APP 必須先就緒，才可發布第 36 款加碼入口。


## 遊戲內共用工具（revision 6）

開發前須讀 [GAME_UI_STANDARD.md](GAME_UI_STANDARD.md)。SDK 自動載入同目錄 game-ui.js；bootstrap 等它載入後才執行遊戲，以接管音訊輸出。只在收到真實 hostUi protocol 1 後顯示工具。APP 不再顯示遊戲 AppBar。

- `whenGameUiReady()`：等待共用工具模組載入；回傳 false 表示載入失敗。
- `configureGameUi({help,settings})`：登記本遊戲的說明 callback 與 `{label,get,set}` 設定。
- `getHostUiState()`／`onHostUiChange(callback)`：取得／訂閱經目前橋接來源、房間與 SID 核對的版本化 UI 狀態副本。
- `requestGameUi(kind,fields)`：送 READY、MUTE、VOLUME、HAPTIC、MIC、PEER_AUDIO、SYNC、LEAVE 本人意圖。APP 再驗證座位與權限；沒有改銀幣操作。

hostUi 包含 protocol、version、gameName、help、silverCoins、muted、volume(0–1)、hapticEnabled、micMuted、speechActive、ending、message 及當前真實房間 players。UI 更新使用 hostUiState 並帶 roomId、gameSessionId。整體音量和靜音不改遊戲個別設定；停用震動時 SDK.haptic 不發送回饋。

房間 AI 與最低開局人數的統一標準見 [ROOM_AI_STANDARD.md](ROOM_AI_STANDARD.md)。正式遊戲只使用 SDK.getAiSeats() 的已確認虛擬座位；不得在遊戲內自動補 AI 或變更房間難度。


## 官方遊戲共用加碼與觀戰（revision 8）

Revision 9 沿用 v2：`getSeats()` 回傳 kind=human/ai 的公開座位副本；`getAiSeats()` 的 level 由伺服器鎖定。`getOfficialRules()` 回傳 rankingRule、distribution 和五子棋 tournament 的完整 rounds/byes；`getSpectatorTargets()` 回傳公開棋盤 ID／參賽者 ID；`getAuthoritativeRankings()` 只在 resultVerified 時回傳正式排名副本，未驗證時為空陣列。選桌是本機顯示選擇，不授予操作權限。五子棋 MOVE/RESIGN 額外帶 tableId，仍使用 SID、commandId 與 expectedVersion。

五子棋 1 真人＋AI、2 真人保留三勝制；3–10 真人使用單循環多桌積分賽，每對交手一次、奇數輪空一次。規則及所有輪次先公開並隨加碼共同確認；每桌 120 秒、每步 20 秒、輪間倒數 3.5 秒。勝3分平1分負0分，依積分／勝場排列，仍同分並列。退出不派彩；觀戰者與非本桌參賽者不能落子。固定入場費已扣，不再次從可用錢包扣除；HELD 加碼也已扣款，避免重複扣減鎖定金額。

多桌 MOVE／RESIGN 可帶 `tableVersion`：伺服器驗目前該桌版本，且 expectedVersion 不得是未來 session 版本；其他棋盤更新不撤銷此桌尚未變動的落子版本。未提供 tableVersion 的舊 v2 命令沿用嚴格 session 版本檢查。UI 暫存落子只由該桌版本／已接受落子核對，不因其他桌封包提早清除。

`getSeats().seatIndex` 是開局時凍結的房間座位索引（0–9），不把過濾後的真人名單序號誤當座位。舊 session 未保存此欄位時真人回傳 null，不猜造位置。真人與 AI 索引不能重疊；觀眾晚進入語音席位不改此參賽快照。

- `getWagerState()` 取得伺服器的 supported、phase、epoch、round、amount、limit、本人 balance、proposals、consents、rankingRule、distribution 與 settlement。讀不到別人的錢包。
- `requestWager(kind, amount)` 支援 VOTE、CONFIRM、DECLINE、START、SYNC；BLUFF 的 CONFIGURE 接受 deckCount／challengeMode。Tetris 對接原本 TETRIS_COMMAND，其他官方引擎透過 APP 的 game:wager ACK。
- 100 入場費先前已收取，0 加碼不再次扣款。提案取最高票、同票低額；全員明確確認同一 epoch 與金額才可由原房主 START。確認超過 60 秒、離線、規則變更失效。任何 AI 參賽時只可加碼 0。
- 桌面與行動 HTML5 都載入共用工具／加碼面板。面板可以先關閉以選模式或角色，之後從遊戲選單重新打開。正式銀幣加碼沒有客戶端定價或結果入口。
- `WAGER_STATE`、`BOOMGOLD_STATE`、`STACK_STATE`、`ARENA_STATE` 為 SYSTEM 保留事件，payload 包含本人 userId 與 session；SDK 驗身份、SID 與非倒退 version 後更新 canonical session。
- `OFFICIAL_3` 等註冊引擎透過 `sdk.sendCommand('ARENA_COMMAND', kind, {round,...fields})`。UUID 去重、身份由 Socket 認證，server.act 驗玩法。PROPOSAL 僅允許 EXIT、READY、本人 SELECT，以及原房主 CONFIGURE；規則／角色變更撤銷舊同意。
- 官方 adapter 為 `window.BoomRoomOfficialClientAdapters[number]`，draw 使用 canvas.width／height（CSS 邏輯尺寸）；controls 可含 fields 函式、文字 input／field、release 函式／物件、hold:true 每 300ms 重送。pointer 接收 down／move／up／cancel，key 接收 down／up；釋放意圖不可被一般節流吞掉。
- 1、2、17、30、36 使用其專用引擎；其他官方遊戲使用 registry 與 ARENA transport。35 保留原生操作，伺服器保存官方曲庫譜面與 SHA，等待所有玩家準備同一 SHA；觀戰使用四軌公開 renderer。逐次判定使用伺服器收到時間與固定 100ms 補償，客戶端 timestamp 不能選擇命中等級。
- TOP3：兩人冠軍全拿，三人以上前三名 70／20／10 並列分配。退出者不派彩，有效名額不足時按剩餘權重分完整池。WINNERS：rank 1 真人平分；無有效真人勝者整池退款。27 依已鎖定模式在 server state 決定分配。中斷或未完成對局退還未結算加碼。
- game:watch 以房間 instance／SID 訂閱公開快照，30 秒租約、APP 每 10 秒續租。選擇玩家在本機切換，伺服器不为每位觀戰者要求玩家多傳一份資料。一般進行中觀戰上限 5Hz，終局另送一次收據；沒有有效訂閱時不建立或發送額外公開觀戰封包。正常對局／語音仍有流量。
- 後端、APP 與遊戲資源要一起發布。source 編譯／語法檢查不代表已完成多人實玩、錢包故障演練或 100 人負載驗收。
- 語音猜題使用 requestSpeech('START'／'STOP', 整數工作階段ID) 及 onSpeechResult。Flutter 管理房間麥克風切換，結果回綁工作階段；15 adapter 再綁 turnIndex 發 GUESS，由伺服器核對私有答案。文字猜測仍可使用。共用 shell 支援 adapter.attach(sdk,{send,showMessage})／local() 處理本機辨識意圖與清理。
