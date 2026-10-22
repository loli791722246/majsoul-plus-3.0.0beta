import { BrowserWindow } from 'electron'
import * as path from 'path'
import { pathToFileURL } from 'url'

export let AudioPlayer: BrowserWindow

/**
 * 初始化音频播放器
 */
export function initPlayer() {
  AudioPlayer = new BrowserWindow({
    show: false
  })
  AudioPlayer.loadURL(
    pathToFileURL(path.join(__dirname, '../bin/audio/player.html')).toString()
  )
}
/**
 * 退出播放器窗口
 */
export function shutoffPlayer() {
  AudioPlayer.close()
}
