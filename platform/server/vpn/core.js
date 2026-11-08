import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { parse } from 'acorn';

export function assertUsableProfiles(profiles) {
  if (!Array.isArray(profiles) || !profiles.length) {
    throw Error('Подписка не содержит VPN-подключений');
  }
  if (profiles.some((p) => ['0.0.0.0', '::', '[::]'].includes(p.host))) {
    throw Error(
      'Подписка вернула служебную заглушку вместо VPN-подключений. Проверьте доступ устройства.'
    );
  }
}

function parseXraySubscription(source) {
  let configs;
  try {
    const value = JSON.parse(source);
    configs = Array.isArray(value) ? value : [value];
  } catch {
    throw Error('Подписка содержит некорректный Xray JSON');
  }
  const records = [];
  for (const [index, config] of configs.entries()) {
    if (!config || !Array.isArray(config.outbounds)) {
      throw Error(`Запись ${index + 1}: отсутствуют Xray outbounds`);
    }
    for (const outbound of config.outbounds) {
      if (['freedom', 'blackhole', 'dns', 'loopback'].includes(outbound.protocol)) {
        continue;
      }
      if (!['vless', 'hysteria'].includes(outbound.protocol)) {
        throw Error(`Запись ${index + 1}: неподдерживаемый VPN-протокол`);
      }
      if (
        Object.keys(outbound).some(
          (key) => !['tag', 'protocol', 'settings', 'streamSettings', 'mux'].includes(key)
        ) ||
        outbound.streamSettings?.sockopt?.dialerProxy
      ) {
        throw Error(`Запись ${index + 1}: цепочки outbound не поддерживаются`);
      }
      const network = outbound.streamSettings?.network || 'tcp',
        security = outbound.streamSettings?.security || 'none';
      if (
        !['tcp', 'raw', 'ws', 'grpc', 'xhttp', 'httpupgrade', 'hysteria'].includes(network) ||
        !['none', 'tls', 'reality'].includes(security) ||
        outbound.streamSettings?.tlsSettings?.allowInsecure
      ) {
        throw Error(`Запись ${index + 1}: неподдерживаемые настройки транспорта`);
      }
      if (outbound.protocol === 'hysteria') {
        const { settings } = outbound;
        if (
          !settings ||
          typeof settings.address !== 'string' ||
          !settings.address ||
          !Number.isInteger(settings.port) ||
          settings.port < 1 ||
          settings.port > 65535 ||
          settings.version !== 2 ||
          network !== 'hysteria' ||
          security !== 'tls'
        ) {
          throw Error(`Запись ${index + 1}: неподдерживаемые настройки Hysteria`);
        }
        records.push({
          id: randomUUID(),
          name: String(config.remarks || outbound.tag || `Подключение ${records.length + 1}`).slice(
            0,
            120
          ),
          host: settings.address,
          port: settings.port,
          network,
          security,
          params: {},
          outbound: structuredClone(outbound),
          sourceFormat: 'xray-json',
          sourceConfigurations: configs.length,
        });
        continue;
      }
      const servers = outbound.settings?.vnext;
      if (!Array.isArray(servers) || !servers.length) {
        throw Error(`Запись ${index + 1}: отсутствует VLESS-сервер`);
      }
      for (const server of servers) {
        if (
          typeof server.address !== 'string' ||
          !server.address ||
          !Number.isInteger(server.port) ||
          server.port < 1 ||
          server.port > 65535 ||
          !Array.isArray(server.users) ||
          !server.users.length
        ) {
          throw Error(`Запись ${index + 1}: некорректный VLESS-сервер`);
        }
        for (const user of server.users) {
          if (
            typeof user.id !== 'string' ||
            !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(user.id)
          ) {
            throw Error(`Запись ${index + 1}: некорректный VLESS UUID`);
          }
          const raw = structuredClone(outbound);
          raw.settings.vnext = [{ ...structuredClone(server), users: [structuredClone(user)] }];
          records.push({
            id: randomUUID(),
            name: String(
              config.remarks || outbound.tag || `Подключение ${records.length + 1}`
            ).slice(0, 120),
            host: server.address,
            port: server.port,
            uuid: user.id,
            network,
            security,
            params: {},
            outbound: raw,
            sourceFormat: 'xray-json',
            sourceConfigurations: configs.length,
          });
        }
      }
    }
  }
  if (!records.length) {
    throw Error('Подписка не содержит серверных VLESS-подключений');
  }
  assertUsableProfiles(records);
  const auxiliaryOutbounds = configs.reduce(
    (sum, config) =>
      sum +
      config.outbounds.filter((o) =>
        ['freedom', 'blackhole', 'dns', 'loopback'].includes(o.protocol)
      ).length,
    0
  );
  records.forEach((record) => {
    record.auxiliaryOutbounds = auxiliaryOutbounds;
  });
  return records;
}

export function parseSubscription(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 10 * 1024 * 1024) {
    throw new Error('Подписка превышает 10 MiB');
  }
  let source = text.trim();
  if (source.startsWith('{') || source.startsWith('[')) {
    return parseXraySubscription(source);
  }
  if (!source.startsWith('vless://')) {
    if (!/^[\w+/=\s-]+$/.test(source)) {
      throw new Error('Ожидается список VLESS или Base64');
    }
    source = Buffer.from(source.replace(/\s/g, ''), 'base64url').toString('utf8').trim();
  }
  if (source.startsWith('{') || source.startsWith('[')) {
    return parseXraySubscription(source);
  }
  const lines = source
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new Error('Подписка пуста');
  }
  return lines.map((line, index) => {
    try {
      const u = new URL(line);
      assertUsableProfiles([{ host: u.hostname }]);
      if (
        u.protocol !== 'vless:' ||
        u.password ||
        !u.hostname ||
        !u.port ||
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(u.username)
      ) {
        throw new Error('Некорректный VLESS');
      }
      const params = {};
      const allowed = new Set([
        'type',
        'security',
        'encryption',
        'flow',
        'sni',
        'fp',
        'pbk',
        'sid',
        'spx',
        'alpn',
        'host',
        'path',
        'serviceName',
        'authority',
        'mode',
        'headerType',
        'allowInsecure',
      ]);
      for (const [k, v] of u.searchParams) {
        if (!allowed.has(k)) {
          throw new Error(`Неподдерживаемый параметр ${k.replace(/[^\w]/g, '').slice(0, 30)}`);
        }
        if (k in params) {
          throw new Error('Повтор параметра');
        }
        params[k] = v;
      }
      const network = params.type || 'tcp';
      const security = params.security || 'none';
      if (!['tcp', 'ws', 'grpc', 'xhttp', 'httpupgrade'].includes(network)) {
        throw new Error('Неподдерживаемый транспорт');
      }
      if (!['none', 'tls', 'reality'].includes(security)) {
        throw new Error('Неподдерживаемая защита');
      }
      if (params.encryption && params.encryption !== 'none') {
        throw new Error('Неподдерживаемое шифрование');
      }
      if (params.headerType && !['none', 'http'].includes(params.headerType)) {
        throw new Error('TCP headerType не поддерживается');
      }
      if (
        params.allowInsecure &&
        params.allowInsecure !== '0' &&
        params.allowInsecure !== 'false'
      ) {
        throw new Error('Небезопасный TLS запрещён');
      }
      if (security === 'reality' && (!params.pbk || !params.sni)) {
        throw new Error('Для REALITY нужны pbk и sni');
      }
      if (params.flow && (params.flow !== 'xtls-rprx-vision' || network !== 'tcp')) {
        throw new Error('Неподдерживаемый flow');
      }
      return {
        id: randomUUID(),
        name: decodeURIComponent(u.hash.slice(1)).slice(0, 120) || `Подключение ${index + 1}`,
        host: u.hostname.replace(/^\[|\]$/g, ''),
        port: Number(u.port),
        uuid: u.username,
        network,
        security,
        params,
      };
    } catch (e) {
      throw new Error(
        `Запись ${index + 1}: ${e instanceof TypeError ? 'некорректная ссылка' : e.message}`
      );
    }
  });
}

/** Формирует единственный VPN-маршрут без прямого резервного выхода при отказе туннеля. */
export function xrayConfig(record) {
  const p = record.params;
  const stream = { network: record.network, security: record.security };
  if (record.security === 'reality') {
    stream.realitySettings = {
      serverName: p.sni,
      fingerprint: p.fp || 'chrome',
      publicKey: p.pbk,
      shortId: p.sid || '',
      spiderX: p.spx || '/',
    };
  }
  if (record.security === 'tls') {
    stream.tlsSettings = {
      serverName: p.sni || record.host,
      allowInsecure: false,
      ...(p.fp ? { fingerprint: p.fp } : {}),
      ...(p.alpn ? { alpn: p.alpn.split(',') } : {}),
    };
  }
  if (record.network === 'ws') {
    stream.wsSettings = { path: p.path || '/', headers: p.host ? { Host: p.host } : {} };
  }
  if (record.network === 'grpc') {
    stream.grpcSettings = {
      serviceName: p.serviceName || '',
      authority: p.authority || '',
      multiMode: p.mode === 'multi',
    };
  }
  if (record.network === 'xhttp') {
    stream.xhttpSettings = { path: p.path || '/', host: p.host || '', mode: p.mode || 'auto' };
  }
  if (record.network === 'httpupgrade') {
    stream.httpupgradeSettings = { path: p.path || '/', host: p.host || '' };
  }
  if (record.network === 'tcp' && p.headerType === 'http') {
    stream.tcpSettings = {
      header: {
        type: 'http',
        request: {
          path: [p.path || '/'],
          ...(p.host ? { headers: { Host: p.host.split(',') } } : {}),
        },
      },
    };
  }
  return {
    log: { loglevel: 'none' },
    inbounds: [
      {
        tag: 'load',
        listen: '0.0.0.0',
        port: 8080,
        protocol: 'http',
        settings: { allowTransparent: false },
      },
    ],
    outbounds: [
      record.outbound
        ? { ...structuredClone(record.outbound), tag: 'vpn' }
        : {
            tag: 'vpn',
            protocol: 'vless',
            settings: {
              vnext: [
                {
                  address: record.host,
                  port: record.port,
                  users: [
                    { id: record.uuid, encryption: 'none', ...(p.flow ? { flow: p.flow } : {}) },
                  ],
                },
              ],
            },
            streamSettings: stream,
          },
      { tag: 'blocked', protocol: 'blackhole', settings: {} },
    ],
  };
}

export function distribute(budget, count) {
  if (
    !Number.isSafeInteger(budget) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    budget < count
  ) {
    throw new Error('Общий бюджет должен быть целым и не меньше числа подключений');
  }
  return Array.from(
    { length: count },
    (_, i) => Math.floor(budget / count) + Number(i < budget % count)
  );
}

export function validateLoad(load, kind, count) {
  if (
    !load ||
    !['rps', 'iterations', 'vus'].includes(load.mode) ||
    (kind === 'js' && load.mode === 'rps') ||
    (kind === 'curl' && load.mode === 'iterations')
  ) {
    throw new Error('Неподдерживаемый режим нагрузки');
  }
  distribute(load.budget, Math.min(count, load.budget));
  if (
    load.budget > 10000 ||
    !Number.isInteger(load.duration) ||
    load.duration < 1 ||
    load.duration > 86400
  ) {
    throw new Error('Допустимы бюджет до 10000 и длительность от 1 до 86400 секунд');
  }
  const maxErrorRate = load.maxErrorRate ?? 0.01;
  const maxP95 = load.maxP95 ?? 1000;
  const maxVusPerWorker = load.maxVusPerWorker ?? 20;
  const realityFingerprint = load.realityFingerprint || 'subscription';
  if (!['subscription', 'firefox', 'chrome', 'safari'].includes(realityFingerprint)) {
    throw Error('Некорректный TLS-отпечаток');
  }
  if (
    !Number.isFinite(maxErrorRate) ||
    maxErrorRate < 0 ||
    maxErrorRate > 1 ||
    !Number.isFinite(maxP95) ||
    maxP95 <= 0 ||
    !Number.isInteger(maxVusPerWorker) ||
    maxVusPerWorker < 1 ||
    maxVusPerWorker > 1000
  ) {
    throw new Error('Некорректные пороги');
  }
  return {
    mode: load.mode,
    budget: load.budget,
    duration: load.duration,
    maxErrorRate,
    maxP95,
    maxVusPerWorker,
    realityFingerprint,
    skipUnavailable: load.skipUnavailable !== false,
  };
}

function tokenize(command) {
  if (
    typeof command !== 'string' ||
    command.length > 262144 ||
    /\$\(|`|\$\{|[\r\n](?!\s)/.test(command.replace(/\\\r?\n/g, ' '))
  ) {
    throw new Error('Shell-подстановки запрещены');
  }
  const text = command.replace(/\\\r?\n/g, ' ');
  const tokens = [];
  let token = '',
    quote = '',
    active = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        quote = '';
      } else if (c === '\\' && quote === '"' && ['"', '\\'].includes(text[i + 1])) {
        token += text[++i];
      } else {
        token += c;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      active = true;
    } else if (c === '\\') {
      if (++i >= text.length) {
        throw new Error('Незавершённое экранирование');
      }
      token += text[i];
      active = true;
    } else if (/\s/.test(c)) {
      if (active) {
        tokens.push(token);
        token = '';
        active = false;
      }
    } else {
      if (/[;|&<>]/.test(c)) {
        throw new Error('Shell-операторы запрещены, URL заключите в кавычки');
      }
      token += c;
      active = true;
    }
  }
  if (quote) {
    throw new Error('Незакрытая кавычка');
  }
  if (active) {
    tokens.push(token);
  }
  return tokens;
}

export function validateRequest(request) {
  let u;
  try {
    u = new URL(request.url);
  } catch {
    throw new Error('Некорректный URL');
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
    throw new Error('Нужен HTTP(S) URL без встроенного пароля');
  }
  if (
    !/^[A-Z]{3,16}$/.test(request.method) ||
    !request.headers ||
    typeof request.headers !== 'object' ||
    Array.isArray(request.headers) ||
    (request.body !== null && typeof request.body !== 'string')
  ) {
    throw new Error('Некорректный запрос');
  }
  for (const [key, value] of Object.entries(request.headers)) {
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new Error('Некорректный заголовок');
    }
  }
  for (const value of [request.url, ...Object.values(request.headers), request.body || '']) {
    for (const [, variable] of value.matchAll(/\{\{([^{}]*)\}\}/g)) {
      if (!['random.uuid', 'random.int', 'timestamp'].includes(variable.trim())) {
        throw Error('Неподдерживаемая переменная запроса');
      }
    }
  }
  const expectedStatus = request.expectedStatus === '' ? null : (request.expectedStatus ?? null);
  if (
    expectedStatus !== null &&
    (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599)
  ) {
    throw Error('Некорректный ожидаемый HTTP-статус');
  }
  if (request.cacheBust !== undefined && typeof request.cacheBust !== 'boolean') {
    throw Error('Некорректный режим обхода кэша');
  }
  return {
    url: u.href.replace(
      /%7B%7B(random\.uuid|random\.int|timestamp)%7D%7D/gi,
      (_, name) => `{{${name}}}`
    ),
    method: request.method,
    headers: request.headers,
    body: request.body,
    cacheBust: request.cacheBust ?? false,
    expectedStatus,
  };
}

export function parseCurl(command) {
  const tokens = tokenize(command);
  if (tokens.shift() !== 'curl') {
    throw new Error('Команда должна начинаться с curl');
  }
  let url,
    explicitMethod,
    body = null;
  const headers = {};
  for (let i = 0; i < tokens.length; i++) {
    let flag = tokens[i];
    if (['-s', '--silent', '-S', '--show-error', '--compressed'].includes(flag)) {
      continue;
    }
    const equals = flag.startsWith('--') && flag.includes('=');
    const value = equals ? flag.slice(flag.indexOf('=') + 1) : tokens[i + 1];
    if (equals) {
      flag = flag.slice(0, flag.indexOf('='));
    }
    if (
      [
        '-X',
        '--request',
        '-H',
        '--header',
        '-b',
        '--cookie',
        '-d',
        '--data',
        '--data-raw',
        '--data-binary',
        '--url',
      ].includes(flag)
    ) {
      if (value === undefined) {
        throw new Error('Отсутствует значение опции');
      }
      if (!equals) {
        i++;
      }
      if (['-X', '--request'].includes(flag)) {
        explicitMethod = value.toUpperCase();
      } else if (['-H', '--header'].includes(flag)) {
        const colon = value.indexOf(':');
        if (colon < 1) {
          throw new Error('Некорректный заголовок');
        }
        headers[value.slice(0, colon).trim()] = value.slice(colon + 1).trim();
      } else if (['-b', '--cookie'].includes(flag)) {
        if (!value.includes('=')) {
          throw new Error('Cookie из файла запрещён');
        }
        headers.Cookie = value;
      } else if (flag === '--url') {
        if (url) {
          throw new Error('Разрешён один URL');
        }
        url = value;
      } else {
        if (value.startsWith('@')) {
          throw new Error('Чтение файлов запрещено');
        }
        body = body === null ? value : `${body}&${value}`;
      }
    } else if (flag.startsWith('-')) {
      throw new Error('Неподдерживаемая опция cURL');
    } else {
      if (url) {
        throw new Error('Разрешён один URL');
      }
      url = flag;
    }
  }
  return validateRequest({
    url,
    method: explicitMethod || (body !== null ? 'POST' : 'GET'),
    headers,
    body,
  });
}

export function validateScript(source) {
  if (typeof source !== 'string' || source.length > 262144) {
    throw new Error('JS превышает 256 KiB');
  }
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    throw new Error('Синтаксическая ошибка JS');
  }
  if (
    !ast.body.some(
      (n) =>
        n.type === 'ExportDefaultDeclaration' &&
        ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
          n.declaration.type
        )
    )
  ) {
    throw new Error('Нужна export default функция');
  }
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (node.type === 'ImportDeclaration' && !/^k6(?:\/[-\w/]+)?$/.test(node.source.value)) {
      throw new Error('Разрешены только встроенные модули k6');
    }
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      throw new Error(
        'Именованные экспорты, options, setup и teardown запрещены; нагрузкой управляет UI'
      );
    }
    if (
      node.type === 'ImportExpression' ||
      (node.type === 'Identifier' &&
        ['open', 'require', 'eval', 'Function', 'globalThis'].includes(node.name))
    ) {
      throw new Error('Файлы, динамические импорты и динамический код запрещены');
    }
    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    });
  };
  visit(ast);
  return source;
}

export function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function unseal(value, key) {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()
  );
}
