# 启动取码与掉线重连

参考来源：[zjydipingxian/qq-farm-bot dev 的 relogin-reminder.ts](https://github.com/zjydipingxian/qq-farm-bot/blob/d1556f38d01ad5a6a74adaafdf71a29133787e5b/core/src/runtime/relogin-reminder.ts)。上游通过 `triggerAutoReconnect` 延迟取码，再调用 `applyReloginCode` 更新并重启账号。本项目保留现有通知服务，新增 `core/src/runtime/auto-reconnect.ts`，由 `runtime-engine.ts` 接入账号生命周期。

## 配置和使用

1. 先在“设置 → 账号管理”添加对应微信农场账号；已有账号直接使用。
2. 打开“设置 → 系统设置 → 下线提醒”，找到“启动取码与掉线自动重连”。
3. 选择绑定的农场账号，填写该账号的 OpenID、服务提供的 API Token 和取码接口地址。Token 不包含 `Bearer ` 前缀。
4. 开启开关并点击“保存提醒与重连设置”，再在账号管理中启动该账号。

默认接口：`http://211.154.25.123:28999/api/open/v1/farm/code`。请求为 POST，使用 `Authorization: Bearer <api-token>`、`Content-Type: application/json`，JSON 请求体仅含 `openid`。按上游代码，成功响应必须为 `{ "success": true, "code": "新的登录 Code" }`。AppID 不参与此接口请求。

配置保存在原有运行数据目录的 `store.json` 中，API Token 应只填写在本地管理面板，不要提交至 Git。当前提供的 HTTP 地址明文传输 Token；如果服务支持 HTTPS，请替换地址。

## 行为

- 功能默认关闭。启用后，程序启动、手动启动或重启绑定账号时，先获取新 Code，再启动 Worker。其他账号继续使用现有启动方式。
- 断线或被踢下线时，按配置等待（默认 60 秒，范围 1～86400 秒），取码后重建连接。通知渠道未配置不会阻止重连。
- 同一账号同一时间只进行一次取码；旧 Worker 完全退出后才取码。连续取码、启动或登录失败最多尝试 3 次，达到上限后需检查配置并手动启动；登录在线后重置次数。
- 手动停止、删除账号、关闭重连、修改绑定/凭据或更新账号 Code 后，旧请求不会覆盖账号或重新启动。手动停止只取消当前运行；若保留开关，下一次程序启动仍会自动启动绑定账号。
- 请求失败或无效响应不覆盖旧 Code。HTTP 请求限制 30 秒、64 KiB 响应，不跟随重定向，不记录 Token、Code 或完整响应体。
- 离线自动删除账号优先执行，不会将已删除账号重新创建。需要长期重连时，将“离线删除账号”设为 0。
- 当前一组接口凭据绑定一个农场账号，请确认 OpenID 与所选账号一致。

## 本地验证

`pnpm build:core` 后运行 `node --test core/tests/auto-reconnect.test.js`。测试使用本机模拟接口，不请求真实服务，不登录真实游戏账号。
