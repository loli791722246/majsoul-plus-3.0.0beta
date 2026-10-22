# 以管理员身份运行本脚本
#
# 本机（以及部分使用 Nahimic / A-Volute 音频软件的笔记本）上，
# Nahimic 的 OSD 钩子会让 Electron（Chromium）在创建窗口时崩溃，
# 表现为程序启动后立即退出、事件查看器里能看到 NahimicOSD.dll。
# 本脚本在启动雀魂 Plus 前临时停止 NahimicService，退出后自动恢复。

param(
    [string]$Exe = (Join-Path $PSScriptRoot '..\build\win-unpacked\Majsoul Plus.exe')
)

$errorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) {
    Write-Error "找不到程序：$Exe，请先运行 pnpm run build"
    exit 1
}

$service = Get-Service -Name 'NahimicService' -ErrorAction SilentlyContinue
$stopped = $false

if ($service -and $service.Status -eq 'Running') {
    Write-Host '检测到 NahimicService 正在运行，临时停止以避免 Electron 崩溃……'
    Stop-Service -Name 'NahimicService' -Force
    $stopped = $true
    Start-Sleep -Seconds 1
}

try {
    Write-Host "启动 $Exe"
    & $Exe
}
finally {
    if ($stopped) {
        Write-Host '恢复 NahimicService……'
        Start-Service -Name 'NahimicService' -ErrorAction SilentlyContinue
    }
}
