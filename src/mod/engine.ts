import { FrameHandler, FrameResult } from '../mitm/websocket'
import { MaxData } from './data'
import { DecodedFrame, Liqi, MsgType } from './liqi'
import { ModConfig, ModConfigStore, ViewSlotConfig } from './settings'

export interface ModLogger {
  (level: 'debug' | 'info' | 'warn' | 'error', message: string): void
}

interface ModAction {
  modify: boolean
  drop: boolean
  /** 修改后的完整 WebSocket 报文 */
  frame?: Buffer
  /** 需要额外发给客户端的报文 */
  inject: Buffer[]
}

/**
 * 参考 MajsoulMax 的 plugin/mod.py 实现。
 *
 * 通过中间人代理修改雀魂的 protobuf 报文，从而在本地解锁角色、皮肤、装扮等。
 */
export class ModEngine implements FrameHandler {
  private readonly config: ModConfig
  private readonly store: ModConfigStore
  private readonly typeCache: Map<string, any> = new Map()
  private readonly itemSet: Set<number>
  /** 每个连接独立的消息编号 -> 响应类型映射 */
  private readonly pendingRes: Map<
    number,
    { method: string; type: string }
  > = new Map()

  private contract = ''
  private accountId = 0
  private characters: any[] = []
  private mainCharacterId = 0

  constructor(
    private readonly liqi: Liqi,
    store: ModConfigStore,
    private readonly maxData: MaxData,
    private readonly log: ModLogger,
    private readonly version: string
  ) {
    this.store = store
    this.config = store.config
    this.itemSet = new Set(maxData.item)
  }

  onClientMessage(data: Buffer, binary: boolean): FrameResult {
    return this.process(data, true)
  }

  onServerMessage(data: Buffer, binary: boolean): FrameResult {
    return this.process(data, false)
  }

  private process(buffer: Buffer, fromClient: boolean): FrameResult {
    const action: ModAction = { modify: false, drop: false, inject: [] }
    let frame: DecodedFrame | null = null
    try {
      frame = this.liqi.decode(buffer, this.pendingRes)
    } catch (error) {
      this.log('error', `解析报文失败: ${error}`)
      return undefined
    }
    if (!frame || !frame.messageType) return undefined

    try {
      switch (frame.type) {
        case MsgType.Notify:
          this.handleNotify(frame, action)
          break
        case MsgType.Req:
          if (!fromClient) return undefined
          this.handleRequest(frame, action)
          break
        case MsgType.Res:
          if (fromClient) return undefined
          this.handleResponse(frame, action)
          break
      }
    } catch (error) {
      this.log(
        'error',
        `处理 ${frame.method || '未知消息'} 出错: ${
          error && (error as Error).stack
        }`
      )
      return undefined
    }

    if (action.modify && frame.messageType) {
      const payload = frame.messageType.encode(frame.message).finish()
      // 响应报文的 method_name 必须为空，请求报文可能被伪造为 loginBeat
      const method =
        frame.type === MsgType.Res
          ? ''
          : (frame as any).methodOverride || frame.method
      action.frame = this.liqi.encodeFrame(
        frame.type,
        frame.id,
        method,
        payload
      )
      this.store.save()
    }

    if (!action.modify && !action.drop && action.inject.length === 0) {
      return undefined
    }

    return {
      drop: action.drop,
      data: action.frame,
      inject: action.inject
    }
  }

  private type(name: string): any {
    const cached = this.typeCache.get(name)
    if (cached) return cached
    const found = this.liqi.lookup(name)
    if (!found) throw new Error(`未找到 protobuf 类型 ${name}`)
    this.typeCache.set(name, found)
    return found
  }

  private create(name: string, object: any): any {
    return this.type(name).create(object)
  }

  private handleNotify(frame: DecodedFrame, action: ModAction) {
    const data = frame.message
    switch (frame.method) {
      case '.lq.NotifyAccountUpdate':
        if (data.update && data.update.character) action.drop = true
        break
      case '.lq.NotifyRoomPlayerUpdate':
        action.modify = true
        for (const p of data.player_list || []) {
          if (p.account_id === this.accountId) {
            p.avatar_id = this.config.characters[String(this.config.character)]
            if (this.config.nickname !== '') p.nickname = this.config.nickname
            p.title = this.config.title
          }
          if (this.config.show_server) {
            p.nickname = this.getZoneId(p.account_id) + (p.nickname || '')
          }
          if (this.config.safe_mode && p.character) {
            p.character.charid = 200001
            p.character.skin = 400101
            p.avatar_id = 400101
          }
        }
        break
      case '.lq.NotifyGameFinishRewardV2': {
        action.modify = true
        const main = data.main_character
        if (main) {
          for (const character of this.characters) {
            if (character.charid === this.mainCharacterId) {
              character.exp = main.exp
              character.level = main.level
              break
            }
          }
          main.add = 0
          main.exp = 0
          main.level = 5
        }
        break
      }
      case '.lq.NotifyCustomContestSystemMsg':
        if (this.config.show_server && data.game_start) {
          action.modify = true
          for (const p of data.game_start.players || []) {
            p.nickname = this.getZoneId(p.account_id) + (p.nickname || '')
          }
        }
        break
      default:
        action.modify = false
        break
    }
  }

  private handleRequest(frame: DecodedFrame, action: ModAction) {
    const data = frame.message
    let fake = false

    switch (frame.method) {
      case '.lq.Lobby.changeMainCharacter':
        fake = true
        this.config.character = data.character_id
        this.store.save()
        break
      case '.lq.Lobby.changeCharacterSkin': {
        fake = true
        this.config.characters[String(data.character_id)] = data.skin
        this.store.save()

        const character = this.create('lq.Character', {
          charid: data.character_id,
          skin: data.skin,
          exp: 0,
          is_upgraded: true,
          level: 5,
          rewarded_level: [1, 2, 3, 4, 5]
        })
        if (this.config.emoji) {
          character.extra_emoji = this.maxData.emoji[data.character_id] || []
        }
        const update = this.create('lq.NotifyAccountUpdate', {
          update: {
            character: { characters: [character] }
          }
        })
        const payload = this.type('lq.NotifyAccountUpdate')
          .encode(update)
          .finish()
        action.inject.push(
          this.liqi.encodeFrame(
            MsgType.Notify,
            -1,
            '.lq.NotifyAccountUpdate',
            payload
          )
        )
        break
      }
      case '.lq.Lobby.addFinishedEnding':
        action.drop = true
        return
      case '.lq.Lobby.updateCharacterSort':
        fake = true
        this.config.star_chars = Array.from(data.sort || [])
        this.store.save()
        break
      case '.lq.Lobby.useTitle':
        fake = true
        this.config.title = data.title
        this.store.save()
        break
      case '.lq.Lobby.setLoadingImage':
        fake = true
        this.config.loading_image = Array.from(data.images || [])
        this.store.save()
        break
      case '.lq.Lobby.saveCommonViews': {
        fake = true
        for (const view of data.views || []) {
          if (
            view.type === 0 &&
            view.item_id_list &&
            view.item_id_list.length
          ) {
            view.item_id_list = []
          } else if (view.type === 1 && view.item_id) {
            view.item_id = 0
          }
        }
        const values: ViewSlotConfig[] = (data.views || []).map(view => ({
          slot: view.slot,
          item_id: view.item_id,
          type: view.type,
          item_id_list: Array.from(view.item_id_list || [])
        }))
        this.config.views[String(data.save_index)] = values
        if (data.is_use === 1) this.config.views_index = data.save_index
        this.store.save()
        break
      }
      case '.lq.Lobby.useCommonView':
        this.config.views_index = data.index
        this.store.save()
        break
      case '.lq.Lobby.loginBeat':
        this.contract = data.contract || ''
        break
      case '.lq.Lobby.readAnnouncement':
        if (data.announcement_id === 666666) fake = true
        break
      case '.lq.Lobby.receiveCharacterRewards':
        fake = true
        break
      case '.lq.Lobby.setRandomCharacter':
        fake = true
        this.config.random_character.enabled = !!data.enabled
        this.config.random_character.pool = (data.pool || []).map(pool => ({
          character_id: pool.character_id,
          skin_id: pool.skin_id
        }))
        this.store.save()
        break
      default:
        return
    }

    if (fake) {
      action.modify = true
      frame.message = this.create('lq.ReqLoginBeat', {
        contract: this.contract
      })
      frame.messageType = this.type('lq.ReqLoginBeat')
      ;(frame as any).methodOverride = '.lq.Lobby.loginBeat'
    }
  }

  private handleResponse(frame: DecodedFrame, action: ModAction) {
    const data = frame.message
    switch (frame.method) {
      case '.lq.Lobby.fetchCharacterInfo':
        action.modify = true
        this.mainCharacterId = data.main_character_id
        this.characters = data.characters || []
        this.fillCharacterInfo(data, this.characters)
        break
      case '.lq.Lobby.login':
      case '.lq.Lobby.oauth2Login':
        action.modify = true
        this.accountId = data.account_id
        this.config.characters[String(this.config.character)] =
          this.config.characters[String(this.config.character)] ||
          defaultSkin(this.config.character)
        if (data.account) {
          data.account.avatar_id =
            this.config.characters[String(this.config.character)] ||
            defaultSkin(this.config.character)
          for (const view of this.currentViews()) {
            if (view.slot === 5) data.account.avatar_frame = view.item_id
          }
          if (this.config.nickname !== '') {
            data.account.nickname = this.config.nickname
          }
          data.account.title = this.config.title
          data.account.loading_image = [...this.config.loading_image]
          data.account.verified = this.config.verified
        }
        break
      case '.lq.Lobby.createRoom':
        action.modify = true
        for (const p of (data.room && data.room.persons) || []) {
          this.applyCharacter(p)
          if (p.account_id === this.accountId) {
            this.applySelf(p, 'character')
          }
          if (this.config.show_server) {
            p.nickname = this.getZoneId(p.account_id) + (p.nickname || '')
          }
        }
        break
      case '.lq.FastTest.authGame':
        action.modify = true
        if (this.config.bianjietishi) {
          const gameConfig = data.game_config
          if (gameConfig && gameConfig.mode) {
            if (gameConfig.mode.detail_rule) {
              gameConfig.mode.detail_rule.bianjietishi = true
            }
            const modeId = Number(
              (gameConfig.meta && gameConfig.meta.mode_id) || 0
            )
            const mapping: { [key: number]: number } = {
              15: 11,
              16: 12,
              25: 23,
              26: 24
            }
            if (mapping[modeId] && gameConfig.meta) {
              gameConfig.meta.mode_id = mapping[modeId]
            }
          }
        }
        for (const p of data.players || []) {
          this.applyCharacter(p)
          if (p.account_id === this.accountId) {
            this.applySelf(p, 'self')
          }
          if (this.config.show_server) {
            p.nickname = this.getZoneId(p.account_id) + (p.nickname || '')
          }
          if (this.config.safe_mode && p.character) {
            p.character.charid = 200001
            p.character.skin = 400101
            p.avatar_id = 400101
          }
        }
        for (const p of data.robots || []) {
          this.applyCharacter(p)
          if (this.config.safe_mode && p.character) {
            p.character.charid = 200001
            p.character.skin = 400101
            p.avatar_id = 400101
          }
        }
        break
      case '.lq.Lobby.fetchAccountInfo':
        if (data.account && data.account.account_id === this.accountId) {
          action.modify = true
          data.account.avatar_id =
            this.config.characters[String(this.config.character)]
          for (const view of this.currentViews()) {
            if (view.slot === 5) data.account.avatar_frame = view.item_id
          }
          if (this.config.nickname !== '') {
            data.account.nickname = this.config.nickname
          }
          data.account.title = this.config.title
          data.account.loading_image = [...this.config.loading_image]
          data.account.verified = this.config.verified
        }
        break
      case '.lq.Lobby.fetchTitleList':
        if (this.config.unlock_titles) {
          action.modify = true
          data.title_list = [...this.maxData.title]
        }
        break
      case '.lq.Lobby.fetchRoom':
        action.modify = true
        for (const p of (data.room && data.room.persons) || []) {
          this.applyCharacter(p)
          if (p.account_id === this.accountId) {
            this.applySelf(p, 'character')
          }
          if (this.config.show_server) {
            p.nickname = this.getZoneId(p.account_id) + (p.nickname || '')
          }
        }
        break
      case '.lq.Lobby.fetchBagInfo':
        action.modify = true
        this.fillBag(data.bag)
        break
      case '.lq.Lobby.fetchAllCommonViews':
        action.modify = true
        data.use = this.config.views_index
        data.views = []
        for (const index of Object.keys(this.config.views)) {
          data.views.push(
            this.create('lq.ResAllcommonViews.Views', {
              index: Number(index),
              values: this.config.views[index]
            })
          )
        }
        break
      case '.lq.Lobby.fetchAnnouncement':
        action.modify = true
        data.announcements = [
          this.create('lq.Announcement', {
            title: '雀魂 Plus 载入成功',
            id: 666666,
            header_image: 'internal://2.jpg',
            content: this.announcementContent()
          }),
          ...(data.announcements || [])
        ]
        break
      case '.lq.Lobby.fetchInfo':
        action.modify = true
        this.fillFetchInfo(data)
        break
      case '.lq.Lobby.fetchServerSettings':
        if (this.config.anti_replace_nickname) {
          action.modify = true
          if (data.settings && data.settings.nickname_setting) {
            data.settings.nickname_setting.enable = 0
            data.settings.nickname_setting.nicknames = []
          }
        }
        break
      case '.lq.Lobby.fetchGameRecord':
        action.modify = true
        this.handleGameRecord(data)
        break
      case '.lq.Lobby.fetchRandomCharacter':
        action.modify = true
        data.enabled = this.config.random_character.enabled
        data.pool = this.config.random_character.pool.map(pool =>
          this.create('lq.RandomCharacter', pool)
        )
        break
      default:
        action.modify = false
        break
    }
  }

  private currentViews(): ViewSlotConfig[] {
    return this.config.views[String(this.config.views_index)] || []
  }

  private applyCharacter(p: any) {
    if (!p.character) {
      p.character = this.create('lq.Character', {
        charid: 200001,
        skin: 400101
      })
    }
    p.character.level = 5
    p.character.is_upgraded = true
    p.character.exp = 0
    p.character.rewarded_level = [1, 2, 3, 4, 5]
  }

  private applySelf(p: any, viewTarget: 'character' | 'self') {
    const characterId = this.config.character
    const skin =
      this.config.characters[String(characterId)] || defaultSkin(characterId)

    if (
      this.config.random_character.enabled &&
      this.config.random_character.pool.length > 0
    ) {
      const pool =
        this.config.random_character.pool[
          Math.floor(Math.random() * this.config.random_character.pool.length)
        ]
      p.character.charid = pool.character_id
      p.avatar_id = pool.skin_id
      p.character.skin = pool.skin_id
    } else {
      p.character.charid = characterId
      p.avatar_id = skin
      p.character.skin = skin
    }

    if (this.config.emoji) {
      p.character.extra_emoji = this.maxData.emoji[p.character.charid] || []
    }
    if (this.config.nickname !== '') p.nickname = this.config.nickname
    p.title = this.config.title
    p.verified = this.config.verified

    const target = viewTarget === 'character' ? p.character : p
    target.views = []
    for (const view of this.currentViews()) {
      target.views.push(this.create('lq.ViewSlot', view))
      if (view.slot === 5) p.avatar_frame = view.item_id
    }
  }

  private fillBag(bag: any) {
    if (!bag) return
    if (!this.config.unlock_items) return
    const items = bag.items || []
    bag.items = []
    for (const item of items) {
      if (!this.itemSet.has(item.item_id)) {
        bag.items.push(this.create('lq.Item', item))
      }
    }
    for (const id of this.maxData.item) {
      bag.items.push(this.create('lq.Item', { item_id: id, stack: 1 }))
    }
    for (const id of this.maxData.loading_image) {
      bag.items.push(this.create('lq.Item', { item_id: id, stack: 1 }))
    }
  }

  private fillCharacterInfo(data: any, characters: any[]) {
    this.characters = characters
    const originalCharacters = Array.isArray(characters) ? characters : []
    const originalSkins = Array.isArray(data.skins) ? data.skins : []

    if (this.config.unlock_characters) {
      data.characters = []
      for (const charid of this.maxData.character) {
        let skin = this.config.characters[String(charid)]
        if (!skin) {
          skin = defaultSkin(charid)
          this.config.characters[String(charid)] = skin
        }
        const character: any = this.create('lq.Character', {
          charid,
          exp: 0,
          is_upgraded: true,
          level: 5,
          rewarded_level: [1, 2, 3, 4, 5],
          skin
        })
        if (this.config.emoji) {
          character.extra_emoji = this.maxData.emoji[charid] || []
        }
        data.characters.push(character)
      }
    } else {
      data.characters = originalCharacters
    }

    data.skins = this.config.unlock_skins
      ? [...this.maxData.skin]
      : originalSkins
    data.main_character_id = this.config.character
    data.character_sort = [...this.config.star_chars]
    data.hidden_characters = []
    data.finished_endings = [...this.maxData.endings]
    data.rewarded_endings = [...this.maxData.endings]
  }

  private fillFetchInfo(data: any) {
    if (data.character_info) {
      this.mainCharacterId = data.character_info.main_character_id
      this.fillCharacterInfo(
        data.character_info,
        data.character_info.characters || []
      )
    }
    if (data.bag_info) this.fillBag(data.bag_info.bag)

    if (this.config.unlock_views) {
      data.all_common_views = this.create('lq.ResAllcommonViews', {
        use: this.config.views_index
      })
      for (const index of Object.keys(this.config.views)) {
        data.all_common_views.views.push(
          this.create('lq.ResAllcommonViews.Views', {
            index: Number(index),
            values: this.config.views[index]
          })
        )
      }
    }

    if (data.title_list && this.config.unlock_titles) {
      data.title_list.title_list = [...this.maxData.title]
    }
    data.random_character = this.create('lq.ResRandomCharacter', {
      enabled: this.config.random_character.enabled,
      pool: this.config.random_character.pool.map(pool =>
        this.create('lq.RandomCharacter', pool)
      )
    })
  }

  private handleGameRecord(data: any) {
    const head = data.head || {}
    const uuid = head.uuid || ''
    let result = '发现读入牌谱！\n'
    for (const account of head.accounts || []) {
      const seatNames = ['東: ', '南: ', '西: ', '北: ']
      result += seatNames[account.seat] || ''
      if (!account.character) {
        account.character = this.create('lq.Character', {
          charid: 200001,
          skin: 400101
        })
      }
      account.character.level = 5
      account.character.is_upgraded = true
      account.character.rewarded_level = [1, 2, 3, 4, 5]
      account.character.exp = 0

      if (account.account_id === this.accountId) {
        result += '（自己）'
        if (
          this.config.random_character.enabled &&
          this.config.random_character.pool.length > 0
        ) {
          const pool =
            this.config.random_character.pool[
              Math.floor(
                Math.random() * this.config.random_character.pool.length
              )
            ]
          account.character.charid = pool.character_id
          account.avatar_id = pool.skin_id
          account.character.skin = pool.skin_id
        } else {
          account.character.charid = this.config.character
          account.avatar_id =
            this.config.characters[String(this.config.character)] ||
            defaultSkin(this.config.character)
          account.character.skin = account.avatar_id
        }
        if (this.config.emoji) {
          account.character.extra_emoji =
            this.maxData.emoji[account.character.charid] || []
        }
        if (this.config.nickname !== '') {
          account.nickname = this.config.nickname
        }
        account.title = this.config.title
        account.views = []
        for (const view of this.currentViews()) {
          account.views.push(this.create('lq.ViewSlot', view))
          if (view.slot === 5) account.avatar_frame = view.item_id
        }
        account.verified = this.config.verified
      } else if (this.config.safe_mode) {
        account.character.charid = 200001
        account.character.skin = 400101
        account.avatar_id = 400101
      }
      if (this.config.show_server) {
        account.nickname =
          this.getZoneId(account.account_id) + (account.nickname || '')
      }
      result += `${this.getZoneId(account.account_id)}${account.nickname}\n`
      result += `账号id: ${account.account_id}   加好友id: ${this.encodeAccountId2(
        account.account_id
      )}\n`
      result += `主视角牌谱链接: ${uuid}_a${this.encodeAccountId(
        account.account_id
      )}\n`
      result += `主视角牌谱链接（匿名）: ${this.encodePaipuUUID(uuid)}_a${this.encodeAccountId(
        account.account_id
      )}_2\n\n`
    }
    result += '注意：只有在同一服务器才能添加好友！'
    this.log('info', result)
  }

  private getZoneId(id: number): string {
    const zone = id >> 23
    if (zone >= 0 && zone <= 6) return '[CN]'
    if (zone >= 7 && zone <= 12) return '[JP]'
    if (zone >= 13 && zone <= 15) return '[EN]'
    return '[??]'
  }

  private encodePaipuUUID(uuid: string): string {
    let result = ''
    const code0 = '0'.charCodeAt(0)
    const codeA = 'a'.charCodeAt(0)
    for (let i = 0; i < uuid.length; i++) {
      const code = uuid.charCodeAt(i)
      let temp = -1
      if (code >= code0 && code < code0 + 10) temp = code - code0
      else if (code >= codeA && code < codeA + 26) temp = code - codeA + 10
      if (temp !== -1) {
        temp = (temp + 17 + i) % 36
        result +=
          temp < 10
            ? String.fromCharCode(temp + code0)
            : String.fromCharCode(temp + codeA - 10)
      } else {
        result += uuid[i]
      }
    }
    return result
  }

  private encodeAccountId(id: number): number {
    return ((7 * id + 1117113) ^ 86216345) + 1358437
  }

  private encodeAccountId2(p: number): number {
    p = 6139246 ^ p
    const H = 67108863
    const S = p & ~H
    let Z = p & H
    for (let i = 0; i < 5; i++) {
      Z = ((511 & Z) << 17) | (Z >> 9)
    }
    return Z + S + 1e7
  }

  private announcementContent(): string {
    return `<color=#f9963b>雀魂 Plus ${this.version}</color>
<b>本工具完全免费、开源，如果您为此付费，说明您被骗了！</b>
<b>本工具仅供学习交流，请在下载后 24 小时内删除。</b>

<color=#f9963b>功能说明：</color>
使用本地中间人代理修改游戏报文，解锁全部角色、皮肤、装扮、称号与加载 CG。
在资源管理器「设置」中可以调整看板娘、昵称等选项。`
  }
}

function defaultSkin(charid: number): number {
  const text = String(charid)
  return Number('40' + text.slice(4) + '01')
}
