# BoomRoom 遊戲內 UI 標準

所有遊戲開發與修改前，須讀本文件、SDK_API.md 與 WAGERING_RULES.md。

APP 遊戲頁不提供固定頂部列。HTML 遊戲使用共用 SDK revision 6 的遊戲內工具；原生遊戲使用 GameToolsMenu。遊戲保留自己的標題、比分、暫停、操作與結果畫面。

平常只顯示右上角「銀幣＋選單」。選單統一包含玩法說明、遊戲總靜音、總音量、支援時的震動、房間麥克風、個別玩家語音、重新同步及返回房間。銀幣來自 APP 已確認的帳戶狀態，HTML 不可自行改餘額。總靜音與音量控制遊戲音樂和音效，房間語音另行控制。

共用 game-ui.js 隔離 CSS、處理安全邊距、焦點與選單鍵盤事件；不得讓選單點擊或 Space 傳給棋盤。個別遊戲透過 configureGameUi 登記玩法與音效／音樂設定。舊 helpBtn 等入口由共用選單接管，避免重複按鈕。保留對局結果的再玩／返回動作。

```js
BoomRoomSDK.configureGameUi({
  help: () => showHelp(),
  settings: [{label: '遊戲音樂', get: () => musicEnabled,
    set: value => setMusicEnabled(value)}],
});
```

遊戲 UI 送出本人的操作意圖，APP 驗證房間、SID、目前帳號及座位後執行。房主結束須等待正式伺服器確認；其他玩家離場按該遊戲規則處理。HTML 不可直接修改錢包、代替其他玩家切麥或聲稱已結算。

必須驗證 320px 手機直向與手機橫向：工具不得遮住標題或操作；選單可捲動、內容不出界。網頁音訊涵蓋 Web Audio 和 HTML audio/video；跨來源子 iframe 內的音訊需由該子遊戲自行接入。實體裝置的揚聲器與震動仍需真機验收。

APP 與遊戲資源須一起更新。SDK 或遊戲載入失敗時，APP 保留最小返回入口；正常 SDK 工具載入後即移除。獨立網址的練習模式保留遊戲本身的設定與返回選單，不建立假的房間或銀幣。

房間 AI 與最低開局人數的統一標準見 [ROOM_AI_STANDARD.md](ROOM_AI_STANDARD.md)。正式遊戲只使用 SDK.getAiSeats() 的已確認虛擬座位；不得在遊戲內自動補 AI 或變更房間難度。
