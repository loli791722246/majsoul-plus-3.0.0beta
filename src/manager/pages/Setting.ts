import { ipcRenderer } from 'electron'
import Global from '../global'
import i18n from '../../i18n'
import { MajsoulPlus } from '../../majsoul_plus'
import Ping from '../utils/Ping'

class Setting {
  userConfig: MajsoulPlus.UserConfig = require(Global.UserConfigPath)
  private modConfig: any = null

  init() {
    this.addSaveListener()
    this.render()
    this.renderFontSection()
    this.renderPortraitSection()
    this.loadModConfig()
  }

  private render = () => {
    const settingInner = document.querySelector('#setting-inner')
    settingInner.innerHTML = ''
    Object.entries(this.userConfig)
      .filter(([section]) => {
        // 设置不渲染的 section（font 由自定义控件渲染）
        return !['localStorage', 'font', 'portrait'].includes(section)
      })
      .forEach(([section, data]) => {
        this.renderSection(settingInner, section, data)
      })
  }

  private renderSection = (settingInner: Element, section: string, data) => {
    const header = document.createElement('h3')
    i18n.text.manager[section].renderAsText(header)

    settingInner.append(header)
    Object.entries(data).forEach(([item, data], index) => {
      this.renderSectionItem({
        settingInner,
        section,
        item,
        data,
        index
      })
    })
  }

  private renderSectionItem = ({
    settingInner,
    section,
    item,
    data,
    index
  }) => {
    const processes = {
      boolean: () =>
        this.renderCheckBoxSectionItem({
          settingInner,
          section,
          item,
          data,
          index
        }),
      number: () =>
        this.renderNumberSectionItem({
          settingInner,
          section,
          item,
          data,
          index
        }),
      string: () => {
        if (item === 'proxyUrl') {
          this.renderTextSectionItem({
            settingInner,
            section,
            item,
            data,
            index
          })
        }
      }
    }
    if (processes[typeof data]) {
      processes[typeof data].call(data)
    }
  }

  private renderCheckBoxSectionItem = ({
    settingInner,
    section,
    item,
    data,
    index
  }) => {
    const checkBox = document.createElement('input')
    checkBox.type = 'checkbox'
    checkBox.id = `config${section}${item}${index}`
    const label = document.createElement('label')
    label.setAttribute('for', checkBox.id)
    i18n.text.manager[item].renderAsText(label)
    checkBox.checked = data
    checkBox.addEventListener('change', () => {
      this.userConfig[section][item] = checkBox.checked
    })
    const div = document.createElement('div')
    div.append(checkBox)
    div.append(label)
    settingInner.append(div)
  }

  private renderNumberSectionItem = ({
    settingInner,
    section,
    item,
    data,
    index
  }) => {
    const input = document.createElement('input')
    input.type = 'number'
    input.id = `config${section}${item}${index}`
    input.value = data
    const label = document.createElement('label')
    label.setAttribute('for', input.id)
    i18n.text.manager[item].renderAsText(label)
    input.addEventListener('change', () => {
      this.userConfig[section][item] = Number(input.value)
    })
    const br = document.createElement('br')
    const div = document.createElement('div')
    div.append(input)
    div.append(label)
    div.append(br)
    settingInner.append(div)
  }

  private renderTextSectionItem({ settingInner, section, item, data, index }) {
    const input = document.createElement('input')
    input.type = 'text'
    input.id = `config${section}${item}${index}`
    input.value = data
    const label = document.createElement('label')
    label.setAttribute('for', input.id)
    i18n.text.manager[item].renderAsText(label)
    input.addEventListener('change', () => {
      this.userConfig[section][item] = input.value
    })
    const br = document.createElement('br')
    const div = document.createElement('div')
    div.append(input)
    div.append(label)
    div.append(br)
    settingInner.append(div)
  }

  private addHeader(settingInner: Element, text: string) {
    const header = document.createElement('h3')
    header.textContent = text
    settingInner.append(header)
  }

  private addFontNumberRow(
    settingInner: Element,
    labelText: string,
    key: 'scale' | 'offsetX' | 'offsetY',
    step: number
  ) {
    const font = this.userConfig.font
    const input = document.createElement('input')
    input.type = 'number'
    input.step = String(step)
    input.value = String(font[key] ?? 0)
    input.id = `font-${key}`
    input.style.cssText = 'width:64px;height:20px;margin-top:4px;font-size:14px'
    const label = document.createElement('label')
    label.htmlFor = input.id
    label.textContent = labelText
    label.style.cssText =
      'margin-left:10px;font-size:14px;color:var(--light-text)'
    input.addEventListener('change', () => {
      const value = Number(input.value)
      ;(font as any)[key] = Number.isFinite(value) ? value : 0
      this.save()
    })
    const div = document.createElement('div')
    div.style.cssText = 'margin-top:2px;padding-left:16px'
    div.append(input)
    div.append(label)
    settingInner.append(div)
  }

  private renderFontSection = () => {
    const settingInner = document.querySelector('#setting-inner')
    if (!settingInner) return
    if (!this.userConfig.font) {
      this.userConfig.font = {
        source: 'youyuan',
        scale: 1,
        offsetX: 0,
        offsetY: 0
      }
    }

    this.addHeader(settingInner, '字体补全')

    const select = document.createElement('select')
    select.id = 'font-source'
    select.style.cssText = 'height:24px;margin-top:4px;font-size:14px'
    const options: Array<[string, string]> = [
      ['youyuan', '幼圆（推荐）'],
      ['kaiti', '楷体'],
      ['heiti', '黑体'],
      ['songti', '宋体'],
      ['yahei', '微软雅黑'],
      ['fangsong', '仿宋'],
      ['deng', '等线']
    ]
    for (const [value, text] of options) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      select.append(option)
    }
    select.value = this.userConfig.font.source || 'youyuan'
    select.addEventListener('change', () => {
      this.userConfig.font.source = select.value
      this.save()
    })

    const row = document.createElement('div')
    row.style.cssText = 'margin-top:4px;padding-left:16px'
    const label = document.createElement('label')
    label.htmlFor = select.id
    label.textContent = '补字字体：'
    label.style.cssText = 'font-size:14px;color:var(--light-text)'
    row.append(label)
    row.append(select)

    const openButton = document.createElement('button')
    openButton.textContent = '打开字体文件夹'
    openButton.style.cssText =
      'margin-left:10px;padding:2px 8px;font-size:12px;cursor:pointer'
    openButton.addEventListener('click', () => {
      ipcRenderer.invoke('open-font-folder').catch(() => {})
    })
    row.append(openButton)
    settingInner.append(row)

    const customHint = document.createElement('p')
    customHint.textContent =
      '也可以把自己喜欢的 ttf / ttc / otf 放到上面的字体文件夹里，刷新后即可选择。'
    customHint.style.cssText =
      'margin-top:2px;padding-left:32px;font-size:12px;color:var(--light-text)'
    settingInner.append(customHint)

    this.loadCustomFonts(select)

    this.addFontNumberRow(settingInner, '字号缩放', 'scale', 0.01)
    this.addFontNumberRow(settingInner, '水平偏移', 'offsetX', 0.005)
    this.addFontNumberRow(settingInner, '垂直偏移', 'offsetY', 0.005)

    const hint = document.createElement('p')
    hint.textContent =
      '缩放 1.0 为原始大小；偏移单位是 em 比例（0.01 = 1%），只影响新补的字形。'
    hint.style.cssText =
      'margin-top:4px;padding-left:32px;font-size:12px;color:var(--light-text)'
    settingInner.append(hint)
  }

  private addPortraitRow(
    settingInner: Element,
    labelText: string,
    key: 'offsetX' | 'offsetY' | 'scale'
  ) {
    const portrait = this.userConfig.portrait
    const input = document.createElement('input')
    input.type = 'number'
    input.step = key === 'scale' ? '0.01' : '1'
    input.value = String(portrait[key] ?? (key === 'scale' ? 1 : 0))
    input.id = `portrait-${key}`
    input.style.cssText = 'width:72px;height:20px;margin-top:4px;font-size:14px'
    const label = document.createElement('label')
    label.htmlFor = input.id
    label.textContent = labelText
    label.style.cssText =
      'margin-left:10px;font-size:14px;color:var(--light-text)'
    input.addEventListener('change', () => {
      const value = Number(input.value)
      portrait[key] = Number.isFinite(value) ? value : 0
      this.save()
    })
    const div = document.createElement('div')
    div.style.cssText = 'margin-top:2px;padding-left:16px'
    div.append(input)
    div.append(label)
    settingInner.append(div)
  }

  private renderPortraitSection = () => {
    const settingInner = document.querySelector('#setting-inner')
    if (!settingInner) return
    if (!this.userConfig.portrait) {
      this.userConfig.portrait = { offsetX: 0, offsetY: 0, scale: 1 }
    }

    this.addHeader(settingInner, '立绘调整（不建议使用）')
    this.addPortraitRow(settingInner, '水平偏移（像素）', 'offsetX')
    this.addPortraitRow(settingInner, '垂直偏移（像素）', 'offsetY')
    this.addPortraitRow(settingInner, '缩放（1=原始）', 'scale')

    const hint = document.createElement('p')
    hint.textContent =
      '不建议使用：游戏内立绘有遮罩，偏移过大仍会被切断。' +
      '建议在本地编辑图片，把人物构图调整到画布中间后再替换。'
    hint.style.cssText =
      'margin-top:4px;padding-left:32px;font-size:12px;color:var(--light-text)'
    settingInner.append(hint)
  }

  private loadCustomFonts(select: HTMLSelectElement) {
    ipcRenderer
      .invoke('list-custom-fonts')
      .then((fonts: Array<{ name: string; path: string }>) => {
        select
          .querySelectorAll('option[data-custom="1"]')
          .forEach(option => option.remove())
        for (const font of fonts || []) {
          const option = document.createElement('option')
          option.value = font.path
          option.textContent = `${font.name}（自定义）`
          option.dataset.custom = '1'
          select.append(option)
        }
        const source = this.userConfig.font.source
        if (
          source &&
          !Array.from(select.options).some(option => option.value === source)
        ) {
          const option = document.createElement('option')
          option.value = source
          option.textContent = `${source}（未找到）`
          option.dataset.custom = '1'
          select.append(option)
        }
        select.value = source || 'youyuan'
      })
      .catch(() => {})
  }

  private loadModConfig = () => {
    ipcRenderer
      .invoke('get-mod-config')
      .then(config => {
        this.modConfig = config || {}
        this.renderUnlockSection()
      })
      .catch(error => console.warn('读取 mod 配置失败', error))
  }

  private renderUnlockSection = () => {
    const settingInner = document.querySelector('#setting-inner')
    if (!settingInner || !this.modConfig) return

    this.addHeader(settingInner, '解锁设置')

    const items: Array<[string, string]> = [
      ['unlock_characters', '解锁全部角色'],
      ['unlock_skins', '解锁全部皮肤'],
      ['unlock_views', '解锁全部装扮'],
      ['unlock_titles', '解锁全部称号'],
      ['unlock_items', '解锁全部道具与加载 CG'],
      ['emoji', '解锁全部表情']
    ]

    for (const [key, text] of items) {
      const checkBox = document.createElement('input')
      checkBox.type = 'checkbox'
      checkBox.id = `mod-${key}`
      checkBox.checked = this.modConfig[key] !== false
      checkBox.addEventListener('change', () => {
        this.modConfig[key] = checkBox.checked
        this.save()
      })
      const label = document.createElement('label')
      label.htmlFor = checkBox.id
      label.textContent = text
      const div = document.createElement('div')
      div.append(checkBox)
      div.append(label)
      settingInner.append(div)
    }
  }

  private handleSaveConfigClick = () => {
    this.save()
    alert(i18n.text.manager.saveSucceeded())
    Ping.setServer(this.userConfig.userData.serverToPlay)
  }

  private addSaveListener = () => {
    const saveBtn = document.querySelector('#save-configs')
    saveBtn.addEventListener('click', this.handleSaveConfigClick)
  }

  save = () => {
    ipcRenderer.sendSync('update-user-config', this.userConfig)
    if (this.modConfig) {
      ipcRenderer.sendSync('set-mod-config-sync', this.modConfig)
    }
  }
}

export default new Setting()
