import type { OfflineReminder } from '../types/config';
export {};

const fetch = require('node-fetch');
const MAX_ATTEMPTS = 3;

function validateReconnectConfig(cfg: Partial<OfflineReminder>): void {
    if (!cfg.reconnectAccountId || !cfg.reconnectOpenid || !cfg.reconnectApiToken) {
        throw new Error('请填写重连账号、OpenID 和 API Token');
    }
    let url: URL;
    try { url = new URL(cfg.reconnectCodeEndpoint || ''); }
    catch { throw new Error('获取 Code 接口地址无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('获取 Code 接口必须是 HTTP/HTTPS 地址，且不能包含用户名或密码');
    }
}

async function requestOpenReconnectCode(cfg: OfflineReminder, signal?: AbortSignal): Promise<string> {
    validateReconnectConfig(cfg);
    let response: any;
    try {
        response = await fetch(cfg.reconnectCodeEndpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.reconnectApiToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ openid: cfg.reconnectOpenid }),
            signal,
            timeout: 30000,
            size: 65536,
            redirect: 'error',
        });
    } catch {
        throw new Error('获取 Code 请求失败或超时，请检查接口地址、网络和服务状态');
    }
    if (!response.ok) throw new Error(`获取 Code 失败（HTTP ${response.status}），请检查 API Token 和服务状态`);
    let data: any;
    try { data = await response.json(); }
    catch { throw new Error('获取 Code 接口未返回有效 JSON'); }
    // dev 分支契约：{ success: true, code: "..." }。不记录响应体，避免泄漏凭据。
    if (data?.success !== true || typeof data.code !== 'string' || !data.code.trim()) {
        throw new Error('获取 Code 接口未返回 success=true 和有效的 code');
    }
    return data.code.trim();
}

interface ReconnectOptions {
    store: any;
    startWorker: (account: any) => boolean;
    hasWorker: (id: string) => boolean;
    log: (tag: string, message: string, extra?: any) => void;
    requestCode?: typeof requestOpenReconnectCode;
}

function createAutoReconnectService(options: ReconnectOptions) {
    const { store, startWorker, hasWorker, log, requestCode = requestOpenReconnectCode } = options;
    const runs = new Map<string, { timer?: ReturnType<typeof setTimeout>; controller: AbortController }>();
    const attempts = new Map<string, number>();
    const getAccount = (id: string) => store.getAccounts().accounts.find((a: any) => String(a.id) === id);
    const configKey = (cfg: OfflineReminder) => JSON.stringify([
        cfg.autoReconnectEnabled, cfg.reconnectAccountId, cfg.reconnectOpenid,
        cfg.reconnectCodeEndpoint, cfg.reconnectApiToken, cfg.reconnectDelaySec,
    ]);
    const isEnabled = (id: string) => {
        const cfg = store.getOfflineReminder();
        return cfg.autoReconnectEnabled === true && cfg.reconnectAccountId === String(id);
    };

    function cancel(id: string): void {
        const run = runs.get(id);
        if (run) {
            clearTimeout(run.timer);
            run.controller.abort();
            runs.delete(id);
        }
        attempts.delete(id);
    }

    function schedule(id: string, immediate = false): boolean {
        id = String(id);
        if (!isEnabled(id) || !getAccount(id)) return false;
        if (runs.has(id)) return true;
        if (immediate) attempts.delete(id);
        if ((attempts.get(id) || 0) >= MAX_ATTEMPTS) {
            log('错误', '自动重连连续失败 3 次，已停止，请检查配置后手动启动', { accountId: id });
            return false;
        }
        const cfg: OfflineReminder = store.getOfflineReminder();
        const account = getAccount(id);
        let expectedCode = account.code;
        const run = { controller: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined };
        runs.set(id, run);
        const current = () => runs.get(id) === run && getAccount(id)?.code === expectedCode
            && getAccount(id)?.createdAt === account.createdAt
            && configKey(store.getOfflineReminder()) === configKey(cfg);
        const delay = Math.max(1000, cfg.reconnectDelaySec * 1000);
        const execute = async () => {
            if (!current()) { if (runs.get(id) === run) cancel(id); return; }
            // 等旧 Worker 完全退出后再取一次性 Code；停止过程中也可取消。
            if (hasWorker(id)) { run.timer = setTimeout(execute, 250); return; }
            attempts.set(id, (attempts.get(id) || 0) + 1);
            try {
                const code = await requestCode(cfg, run.controller.signal);
                if (!current()) return;
                const latest = getAccount(id);
                const updated = store.addOrUpdateAccount({ id, code });
                const saved = updated.accounts.find((a: any) => String(a.id) === id);
                if (!saved || saved.code !== code) throw new Error('新 Code 保存失败');
                expectedCode = code;
                if (!startWorker({ ...latest, code })) {
                    throw new Error('账号启动失败');
                }
                log('系统', '已获取新 Code 并启动账号，等待登录结果', { accountId: id });
            } catch (error: any) {
                if (run.controller.signal.aborted || !current()) return;
                log('错误', `自动取码/重连失败：${error.message}`, { accountId: id });
                if (runs.get(id) === run) runs.delete(id);
                schedule(id);
            } finally {
                if (runs.get(id) === run) runs.delete(id);
            }
        };
        log('系统', immediate ? '正在获取新 Code 以启动账号' : `将在 ${delay / 1000} 秒后尝试自动重连`, { accountId: id });
        run.timer = setTimeout(execute, immediate ? 0 : delay);
        return true;
    }

    return {
        isEnabled, schedule, cancel,
        hasPending: (id: string) => runs.has(String(id)),
        markConnected: (id: string) => attempts.delete(String(id)),
        cancelAll: () => { for (const id of runs.keys()) cancel(id); attempts.clear(); },
    };
}

module.exports = { createAutoReconnectService, requestOpenReconnectCode, validateReconnectConfig };
