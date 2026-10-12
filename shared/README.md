# BoomRoom SDK v2

> **所有遊戲開發／修正的第一份產品必讀文件：[`WAGERING_RULES.md`](WAGERING_RULES.md)。** 即使遊戲不支援加碼也必須先讀，並在設計方案標示「不支援加碼」。其中規定 100 銀幣固定入場費與額外加碼分開、自願投票與全員確認、動態金額上限、伺服器原子扣款、依排名規則分池，以及 AI 僅能用於零加碼練習。完整 SDK 合約見 [`SDK_API.md`](SDK_API.md)；SDK 本身目前沒有通用下注／結算 API。

目前 additive API revision 為 5；第36款 Tetris Battle 直接使用共用 SDK 的正式握手、房間事件、Session 生命週期、completeRound 與 leaveGame。新增 `haptic('selection'|'light'|'medium'|'heavy')`：優先使用瀏覽器震動，原生 WebView 交由新版 APP 的 Flutter HapticFeedback；每50ms最多一次，實機能力不由返回值保證。傳輸版本仍為2，既有遊戲 API 相容。

完整 API、同步/權限模型與接入範例見 [`SDK_API.md`](SDK_API.md)。未來逐款遊戲檢查與修正時可使用遊戲倉庫根目錄的 [`CODEX_遊戲檢查與修正提示.md`](../CODEX_遊戲檢查與修正提示.md)。

共用程式位於 `boomroom-sdk.js`。1–34 與 36 共 35 款 HTML5 遊戲已接入共用啟動器／SDK；第 35 款由原生頁提供對等選單。Flutter 原有橋接保留相容入口，並支援 v2 初始化與事件生命週期。這不代表所有遊戲或所有裝置已驗收。

遊戲先載入 SDK，再載入自己的程式，並等待真正的初始化：

```html
<script src="../shared/boomroom-sdk.js?v=6"></script>
```

```javascript
window.onBoomRoomSDKReady = () => {
  const sdk = window.BoomRoomSDK;
  const session = sdk.getSession();
  const remove = sdk.onGameEvent((eventName, payload, userId) => {
    // userId 是伺服器認證的發訊者；payload 的玩家、分數與勝負仍不可直接相信。
  });
  // 頁面結束時呼叫 remove()，或由 SDK 的 pagehide/dispose 清理。
};
```

`getUser()`、`getRoomPlayers()`、`getSession()` 回傳副本。未初始化時不生成玩家、房間或購買成功；`isReady` 為 false。`getServerTime()` 根據收到的伺服器時間與單調時鐘推進，可與 `session.startTime` 比較，不應自行另產生開始時間。

官方GOMOKU引擎的SYSTEM／GOMOKU_STATE包含服務端Session快照，SDK核對同一對局及非過期版本後更新getSession與時鐘。普通玩家事件不能更新正式Session。這項引擎整合不表示其他遊戲已有可信操作或結果。

支援 `roomId`、`isHost`、`sessionId`（相容 `gameSessionId`）、`sendGameEvent`、`onGameEvent`、`leaveGame`、`requestPurchase`、`onPurchaseSuccess`、`onPurchaseFailed`、`gameOver`、`onPlayerJoin`、`onPlayerLeave`、`onSessionStart`、`onSessionEnd` 與 `onError`。訂閱回傳取消函式；重複購買在回覆前被拒絕，10 秒無回覆回報失敗，可再試；回覆核對 `requestId`，舊回覆及已排程逾時不影響新請求。APP須支援v2回覆協定才可使用這些購買訂閱。

`gameOver(winAmount, score, poolSettlement)` 保留旧參數，僅傳送請求，不代表已發獎。`submitScore` 與 `requestSettlement` 尚未完成正式協定，明確回傳 false 及 UNSUPPORTED 錯誤，不模擬成功。

Web 只接收父框與固定來源的訊息。原生 WebView 由 APP 的初始化入口綁定對局，保留舊適配器相容。這些檢查不等於完整 UGC Sandbox，也不構成遊戲結果證明。

APP 發送 `sdk:game_event` 時必須包含目前 `roomId` 與 UUID `gameSessionId`。後端重新驗證目前登入連線、座位、房間實例及開局參與者，廣播服務端 `userId`、`gameSessionId`、`roomInstanceId`。封包不能跨對局重播；每連線每秒最多 120 筆／1 MiB，同時最多 16 次資格核對。APP 再核對房間與對局。

目前 SDK 回歸使用受控訊息／時鐘環境，不能代替真實瀏覽器、原生裝置、多客戶端自然勝負驗收：

```powershell
node --test test/boomroom_sdk.test.cjs
```

## 五子棋正式操作

新版後端只對固定官方30網址（本機測試另允許loopback 13090/30/index.html）建立GOMOKU引擎。畫面由Session.engine判定模式；舊UGC對局與獨立AI試玩保留原路徑。部署時需協調新版遊戲、APP與後端，避免舊遊戲仍發送客戶端落子事件。

透過sendGameEvent('GOMOKU_COMMAND', command)提交SYNC、MOVE、SET_DIFFICULTY、RESIGN、UNDO_REQUEST／RESPONSE、RESTART_REQUEST／RESPONSE。除SYNC外，須提供新的UUID commandId與目前expectedVersion；MOVE僅使用整數row／col，SET_DIFFICULTY只允許easy／normal／master且限單人首步前，回覆需帶requestId及布林accept。身份來自連線，不採用payload的玩家、顏色、棋盤、分數或勝者。

GOMOKU_STATE與GOMOKU_ERROR為伺服器保留事件。畫面只採用SYSTEM來源與非過期版本；玩家落子可先作本機暫存顯示並播放音效，但不得改動正式棋盤、回合或結算，伺服器拒絕或逾時時回復並同步。伺服器單人AI等候750毫秒後獨立落子，遊戲伺服器每500毫秒推進到期回合；玩家操作仍即時回覆，2秒SYNC只作復原後備。操作歷史与棋盤原子提交。三勝後結果由伺服器驗證，5秒返回由伺服器推進；目前未設定銀幣獎勵，不應顯示已發獎。

## 第17款「爆爆吹牛」正式操作

固定官方 `/17/index.html` 由服務端選擇 `BLUFF` 引擎。`BLUFF_COMMAND` 身分來自已驗證對局參與座位；命令附帶 UUID 與 Session 版本。牌組、實際牌面、手牌、出牌合法性、全員表態的座位優先序、AI、逾時推進及勝者／排名全部在 PostgreSQL 交易中判定。共用 `BLUFF_PUBLIC` 只含公開狀態；APP只把保留事件 `BLUFF_PRIVATE` 單獨送到對應真人座位，內含該人的 Session 私有手牌。Session 公用快照將 BLUFF 的 `engineState` 設為 null；不可將資料庫原始狀態塞入房間廣播、錯誤或其他人的快照。

支援54／108張含大小王牌組、最多10位真人與AI、依序回應及全員先質疑模式。AI和真人呼叫同一規則狀態機。行動逾時由服務端推進；不可信客戶端 `gameOver` 不參與勝負或獎勵。若遊戲已有完整勝負結果，玩家按 `leaveGame()` 退出自己的遊戲頁，房主可選擇結束全房 Session 或開啟新局。

SDK13項與五子棋6項受控來源回歸共19項通過。後端另有規則、實際PostgreSQL及三Socket操作／自然勝負／返回／再玩案例；仍需真實APP棋盤操作、斷線恢復與原生裝置驗收。


## Tetris Battle 權威擴充（revision 5）

第 36 款可加碼，依 WAGERING_RULES 與其 README 完成伺服器投票、全員確認、錢包原子交易及排名分池。TETRIS_PRIVATE 僅由 SYSTEM 送至本人座位，包含同一 Session 的個人棋盤、ack、本人餘額、投票與派彩收據；SDK 會核對本人 userId 及非倒退版本。TETRIS_PRIVATE／TETRIS_ERROR／TETRIS_STATE／TETRIS_QUEUED 均為保留事件。TETRIS_COMMAND 的操作意圖由後端專屬引擎驗證；通用 SDK 的 verifiedScoring／serverAuthoritativeRules 能力仍為 false，不能將此特定遊戲的權威能力套用到其他 UGC。新版後端與 APP 必須先就緒，才可發布第 36 款加碼入口。


遊戲內工具統一採 [GAME_UI_STANDARD.md](GAME_UI_STANDARD.md)。SDK revision 6 配合新版 APP 移除重複頂部列；實際 Chrome 已檢查 35 款工具、音量與靜音，不代表全部遊戲玩法或實體裝置已驗收。

房間 AI 與最低開局人數的統一標準見 [ROOM_AI_STANDARD.md](ROOM_AI_STANDARD.md)。正式遊戲只使用 SDK.getAiSeats() 的已確認虛擬座位；不得在遊戲內自動補 AI 或變更房間難度。
