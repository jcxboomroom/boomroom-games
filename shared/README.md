# BoomRoom SDK v2

共用程式位於 `boomroom-sdk.js`。目前五子棋（30）已載入；其他遊戲仍待逐一遷移。Flutter 原有橋接保留相容入口，並支援 v2 初始化與事件生命週期。這不代表所有遊戲或所有裝置已驗收。

遊戲先載入 SDK，再載入自己的程式，並等待真正的初始化：

```html
<script src="../shared/boomroom-sdk.js?v=2"></script>
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

支援 `roomId`、`isHost`、`sessionId`（相容 `gameSessionId`）、`sendGameEvent`、`onGameEvent`、`requestPurchase`、`onPurchaseSuccess`、`onPurchaseFailed`、`gameOver`、`onPlayerJoin`、`onPlayerLeave`、`onSessionStart`、`onSessionEnd` 與 `onError`。訂閱回傳取消函式；重複購買在回覆前被拒絕，10 秒無回覆回報失敗，可再試；回覆核對 `requestId`，舊回覆及已排程逾時不影響新請求。APP須支援v2回覆協定才可使用這些購買訂閱。

`gameOver(winAmount, score, poolSettlement)` 保留旧參數，僅傳送請求，不代表已發獎。`submitScore` 與 `requestSettlement` 尚未完成正式協定，明確回傳 false 及 UNSUPPORTED 錯誤，不模擬成功。

Web 只接收父框與固定來源的訊息。原生 WebView 由 APP 的初始化入口綁定對局，保留舊適配器相容。這些檢查不等於完整 UGC Sandbox，也不構成遊戲結果證明。

APP 發送 `sdk:game_event` 時必須包含目前 `roomId` 與 UUID `gameSessionId`。後端重新驗證目前登入連線、座位、房間實例及開局參與者，廣播服務端 `userId`、`gameSessionId`、`roomInstanceId`。封包不能跨對局重播；每連線每秒最多 120 筆／1 MiB，同時最多 16 次資格核對。APP 再核對房間與對局。

目前 SDK 回歸使用受控訊息／時鐘環境，不能代替真實瀏覽器、原生裝置、多客戶端自然勝負驗收：

```powershell
node --test test/boomroom_sdk.test.cjs
```

## 五子棋正式操作

新版後端只對固定官方30網址（本機測試另允許loopback 13090/30/index.html）建立GOMOKU引擎。畫面由Session.engine判定模式；舊UGC對局與獨立AI試玩保留原路徑。部署時需協調新版遊戲、APP與後端，避免舊遊戲仍發送客戶端落子事件。

透過sendGameEvent('GOMOKU_COMMAND', command)提交SYNC、MOVE、RESIGN、UNDO_REQUEST／RESPONSE、RESTART_REQUEST／RESPONSE。除SYNC外，須提供新的UUID commandId與目前expectedVersion；MOVE僅使用整數row／col，回覆需帶requestId及布林accept。身份來自連線，不採用payload的玩家、顏色、棋盤、分數或勝者。

GOMOKU_STATE與GOMOKU_ERROR為伺服器保留事件。畫面只採用SYSTEM來源與非過期版本，不本地預先落子或計分。同步以2秒間隔限制，錯誤不立即重送形成迴圈；操作歷史与棋盤原子提交。三勝後結果由伺服器驗證，5秒返回由伺服器推進；目前未設定銀幣獎勵，不應顯示已發獎。

SDK13項與五子棋6項受控來源回歸共19項通過。後端另有規則、實際PostgreSQL及三Socket操作／自然勝負／返回／再玩案例；仍需真實APP棋盤操作、斷線恢復與原生裝置驗收。
