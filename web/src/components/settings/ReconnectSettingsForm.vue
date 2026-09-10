<script setup lang="ts">
import type { OfflineConfig } from '@/stores/setting'
import { computed } from 'vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

const props = defineProps<{ accounts: { id: string, name: string }[] }>()
const model = defineModel<OfflineConfig>({ required: true })
const accountOptions = computed(() => props.accounts.map(account => ({ label: account.name, value: String(account.id) })))
function update<K extends keyof OfflineConfig>(key: K, value: OfflineConfig[K]) {
  model.value = { ...model.value, [key]: value }
}
</script>

<template>
  <div class="reconnect-settings">
    <BaseSwitch :model-value="model.autoReconnectEnabled" label="启动取码与掉线自动重连" @update:model-value="update('autoReconnectEnabled', !!$event)" />
    <div class="reconnect-fields">
      <BaseSelect :model-value="model.reconnectAccountId" :options="accountOptions" label="绑定农场账号" @update:model-value="update('reconnectAccountId', String($event))" />
      <BaseInput :model-value="model.reconnectOpenid" label="OpenID" placeholder="填写此农场账号对应的 OpenID" @update:model-value="update('reconnectOpenid', String($event))" />
      <BaseInput :model-value="model.reconnectCodeEndpoint" label="获取 Code 接口" @update:model-value="update('reconnectCodeEndpoint', String($event))" />
      <BaseInput :model-value="model.reconnectApiToken" type="password" label="API Token" placeholder="仅填 Token，不含 Bearer 前缀" autocomplete="new-password" @update:model-value="update('reconnectApiToken', String($event))" />
      <BaseInput :model-value="model.reconnectDelaySec" type="number" min="1" max="86400" label="重连等待时间（秒）" @update:model-value="update('reconnectDelaySec', Number($event))" />
    </div>
    <p class="reconnect-hint">
      保存后，程序启动时会自动启动绑定账号；手动启动和掉线重连也会获取新 Code。连续失败最多尝试 3 次；手动停止会取消本次重连。请确认 OpenID 与所选账号一致。AppID 无需填写。
    </p>
    <p v-if="model.reconnectCodeEndpoint.startsWith('http:')" class="reconnect-hint">
      当前接口使用 HTTP，API Token 将明文传输；服务支持 HTTPS 时建议更换为 HTTPS 地址。
    </p>
  </div>
</template>

<style scoped>
.reconnect-settings {
  margin-top: 1rem;
}

.reconnect-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.reconnect-hint {
  margin-top: 0.75rem;
  font-size: 0.75rem;
  line-height: 1.6;
  opacity: 0.7;
}

@media (max-width: 640px) {
  .reconnect-fields {
    grid-template-columns: 1fr;
  }
}
</style>
