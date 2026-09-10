const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createAutoReconnectService, requestOpenReconnectCode } = require('../dist/runtime/auto-reconnect');

const config = () => ({ autoReconnectEnabled: true, reconnectAccountId: '1', reconnectOpenid: 'test-openid', reconnectApiToken: 'test-token', reconnectCodeEndpoint: 'http://localhost/code', reconnectDelaySec: 1 });

function fixture(t, requestCode = async () => 'fresh-code') {
    let cfg = config();
    let accounts = [{ id: '1', name: '农场', code: 'old-code', platform: 'wx', createdAt: 1, avatar: 'avatar' }];
    const starts = [];
    let busy = false;
    let calls = 0;
    const service = createAutoReconnectService({
        store: {
            getOfflineReminder: () => cfg,
            getAccounts: () => ({ accounts }),
            addOrUpdateAccount: update => {
                accounts = accounts.map(a => a.id === update.id ? { ...a, ...update } : a);
                return { accounts };
            },
        },
        startWorker: account => { starts.push(account); return true; },
        hasWorker: () => busy,
        requestCode: (...args) => { calls++; return requestCode(...args); },
        log: () => {},
    });
    t.after(() => service.cancelAll());
    return { service, starts, accounts: () => accounts, calls: () => calls,
        setConfig: value => { cfg = { ...cfg, ...value }; },
        setAccounts: value => { accounts = value; },
        setBusy: value => { busy = value; } };
}

test('Open API contract sends Bearer + openid and rejects malformed/error responses without exposing payloads', async (t) => {
    let response = { success: true, code: ' fresh-code ' };
    let status = 200;
    const server = http.createServer(async (req, res) => {
        assert.equal(req.method, 'POST');
        assert.equal(req.headers.authorization, 'Bearer test-token');
        assert.equal(req.headers['content-type'], 'application/json');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { openid: 'test-openid' });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const cfg = { ...config(), reconnectCodeEndpoint: `http://127.0.0.1:${server.address().port}/code` };
    assert.equal(await requestOpenReconnectCode(cfg), 'fresh-code');
    for (const body of [{ success: false, code: 'private-code' }, { success: true, code: 123 }, { success: true, code: '' }]) {
        response = body;
        await assert.rejects(requestOpenReconnectCode(cfg), /未返回 success=true/);
    }
    status = 401;
    response = { error: 'private-token' };
    await assert.rejects(requestOpenReconnectCode(cfg), error => error.message.includes('HTTP 401') && !error.message.includes('private-token'));
});

test('startup fetches once, binds the correct account and preserves profile/platform', async (t) => {
    const f = fixture(t);
    assert.equal(f.service.schedule('2', true), false);
    assert.equal(f.service.schedule('1', true), true);
    assert.equal(f.service.schedule('1', true), true);
    await delay(30);
    assert.equal(f.calls(), 1);
    assert.equal(f.starts[0].code, 'fresh-code');
    assert.equal(f.starts[0].platform, 'wx');
    assert.equal(f.starts[0].avatar, 'avatar');
    assert.equal(f.accounts()[0].code, 'fresh-code');
});

test('manual stop cancels delayed and in-flight reconnects', async (t) => {
    let resolve;
    const f = fixture(t, () => new Promise(r => { resolve = r; }));
    f.service.schedule('1');
    f.service.cancel('1');
    await delay(20);
    assert.equal(f.calls(), 0);
    f.service.schedule('1', true);
    await delay(20);
    f.service.cancel('1');
    resolve('late-code');
    await delay(20);
    assert.equal(f.starts.length, 0);
    assert.equal(f.accounts()[0].code, 'old-code');
});

test('deleted accounts, changed credentials and manually refreshed codes invalidate in-flight work', async (t) => {
    for (const change of [f => f.setAccounts([]), f => f.setConfig({ autoReconnectEnabled: false }), f => f.setAccounts([{ ...f.accounts()[0], code: 'manual-code' }])]) {
        let resolve;
        const f = fixture(t, () => new Promise(r => { resolve = r; }));
        f.service.schedule('1', true);
        await delay(20);
        change(f);
        resolve('late-code');
        await delay(20);
        assert.equal(f.starts.length, 0);
        assert.equal(f.service.hasPending('1'), false);
    }
});

test('failed requests preserve old code and stop after three attempts', async (t) => {
    const f = fixture(t, async () => { throw new Error('unavailable'); });
    f.service.schedule('1', true);
    await delay(2200);
    assert.equal(f.calls(), 3);
    assert.equal(f.starts.length, 0);
    assert.equal(f.accounts()[0].code, 'old-code');
    assert.equal(f.service.hasPending('1'), false);
    assert.equal(f.service.schedule('1'), false);
});

test('login failures count across worker starts; connected status resets the retry budget', async (t) => {
    const f = fixture(t);
    f.service.schedule('1', true);
    await delay(25);
    f.service.schedule('1');
    await delay(1050);
    f.service.schedule('1');
    await delay(1050);
    assert.equal(f.calls(), 3);
    assert.equal(f.service.schedule('1'), false);
    f.service.markConnected('1');
    assert.equal(f.service.schedule('1'), true);
});

test('waits for the old worker to exit before consuming a fresh code', async (t) => {
    const f = fixture(t);
    f.setBusy(true);
    f.service.schedule('1', true);
    await delay(25);
    assert.equal(f.calls(), 0);
    f.setBusy(false);
    await delay(300);
    assert.equal(f.calls(), 1);
    assert.equal(f.starts.length, 1);
});
