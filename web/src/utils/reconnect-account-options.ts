import type { Account } from '@/stores/account'

export interface ReconnectAccountOption {
  label: string
  value: string
}

function platformLabel(platform?: string): string {
  if (platform === 'wx')
    return '微信'
  if (platform === 'qq')
    return 'QQ'
  return '未知平台'
}

export function buildReconnectAccountOptions(accounts: Pick<Account, 'id' | 'name' | 'nick' | 'platform' | 'uin'>[]): ReconnectAccountOption[] {
  return accounts.map((account) => {
    const id = String(account.id)
    const name = String(account.name || account.nick || '未命名账号').trim()
    const identity = Number(account.uin) > 0 ? String(account.uin) : id
    return {
      label: `${name} · ${platformLabel(account.platform)} · ${identity}`,
      value: id,
    }
  })
}
