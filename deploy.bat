@echo off
chcp 65001 >nul
echo ==============================================
echo 🚀 開始自動推播 BoomRoom UGC 遊戲到 GitHub Pages
echo ==============================================

cd /d C:\JCX\BoomRoom\boomroom-games

:: 1. 確保此專案的獨立身分
git config user.name "jcxboomroom"

:: 2. 加入所有修改並提交
git add .
set /p commit_msg="請輸入本次更新說明 (直接按 Enter 則使用預設): "
if "%commit_msg%"=="" set commit_msg="更新遊戲內容"

git commit -m "%commit_msg%"

:: 3. 推播到 main 分支
echo.
echo 正在推播至 GitHub...
git push origin main

echo.
echo ==============================================
echo ✅ 部署完成！GitHub Pages 將在 1~2 分鐘內自動更新。
echo 網址: https://jcxboomroom.github.io/boomroom-games/
echo ==============================================
pause