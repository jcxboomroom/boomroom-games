// shared/boomroom-sdk.js
// 這是供電腦瀏覽器本地測試用的 Mock SDK
if (!window.BoomRoomSDK) {
    console.warn("⚠️ 偵測到非 App 環境，已載入 BoomRoom 測試用 SDK");
    window.BoomRoomSDK = {
        getUser: function() {
            return { id: 999, username: "測試開發者", avatar: "avatar_blue", title: "創世神" };
        },
        requestPurchase: function(itemId, cost) {
            console.log(`[SDK 模擬] 請求購買 ${itemId}，花費 ${cost} 銀幣`);
            // 模擬 1 秒後購買成功
            setTimeout(() => {
                if (window.onPurchaseSuccess) window.onPurchaseSuccess(itemId);
            }, 1000);
        },
        sendRoomMessage: function(msg) {
            console.log(`[SDK 模擬廣播] 📢 ${msg}`);
        },
        gameOver: function(winAmount) {
            console.log(`[SDK 模擬結算] 遊戲結束，贏得 ${winAmount} 銀幣`);
            alert(`遊戲結束！贏得 ${winAmount} 銀幣\n(請查看 Console 日誌)`);
        }
    };
    
    // 延遲觸發 Ready 事件
    setTimeout(() => {
        if (window.onBoomRoomSDKReady) window.onBoomRoomSDKReady();
    }, 500);
}