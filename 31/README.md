# BoomRoom 爆爆貪吃蛇 v2

這一版把多人核心改成「權威世界狀態 + 玩家輸入」：

- Android APK ↔ Android APK
- Web ↔ Android APK
- Web ↔ Web
- 單人瀏覽器 Mock 模式

## 網路協議

`PLAYER_HELLO` / `PLAYER_HEARTBEAT` / `AUTHORITY_ANNOUNCE` / `ROUND_START` / `INPUT` / `SNAPSHOT` / `ROUND_RESULT` / `PLAYER_LEAVE`

Web iframe 發送給父層時一律 `JSON.stringify()`；有 `BoomRoomSDK.sendGameEvent()` 時優先使用 SDK。

## 重要差異

舊版只同步 `SNAKE_MOVE`，每台裝置各自產生食物與跑完整世界，因此一定可能分歧。

新版只有 Authority 執行權威模擬；其他裝置只送自己的輸入並接收 `SNAPSHOT`，所以食物、位置、分數、生命、淘汰與結算由同一份世界狀態決定。

## 本機測試

直接開 `index.html` 即可進入開發測試模式，不會因 SDK 不存在白畫面。
