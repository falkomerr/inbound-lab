import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { selectVerifiedProfiles } from './availability.js';
import {
  parseSubscription,
  parseCurl,
  validateLoad,
  validateRequest,
  validateScript,
  assertUsableProfiles,
} from './core.js';

export async function fetchSubscription(url) {
  let current;
  try {
    current = new URL(url);
  } catch {
    throw Error('Некорректный URL подписки');
  }
  for (let hops = 0; hops < 4; hops++) {
    if (!['https:', 'http:'].includes(current.protocol) || current.username || current.password) {
      throw Error('Нужен HTTP(S) URL подписки');
    }
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: globalThis.AbortSignal.timeout(15000),
        headers: {
          'User-Agent': process.env.SUBSCRIPTION_USER_AGENT || 'Happ/3.13.0 InboundLab/1.0',
          Accept: 'text/plain, application/json',
          ...(process.env.SUBSCRIPTION_HWID_FILE
            ? { 'x-hwid': readFileSync(process.env.SUBSCRIPTION_HWID_FILE, 'utf8').trim() }
            : {}),
        },
      });
    } catch {
      throw Error('Не удалось загрузить подписку');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      current = new URL(response.headers.get('location'), current);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw Error(`Сервер подписки вернул HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > 10 * 1024 * 1024) {
        await reader.cancel();
        throw Error('Подписка превышает 10 MiB');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw Error('Слишком много перенаправлений подписки');
}

export function createVpnRouter({
  store,
  auth,
  admin,
  fetchSubscription: fetchSub = fetchSubscription,
  notify = async () => {},
  metrics = async () => null,
}) {
  const router = Router();
  router.use(auth, admin);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const route = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const known =
        /^(Запись \d+:|Подписка|Ожидается|Общий бюджет|Неподдерживаем|Разрешен|Разрешён|Нуж|Некоррект|Отсутствует|Shell|Чтение файлов|Cookie|Синтаксическая|Именованные|Файлы|JS превышает|Допустимы|Команда|Незакрытая|Незавершённое|Слишком много|Не удалось загрузить|Сервер подписки)/.test(
          error.message
        );
      res.status(error.message === 'notfound' ? 404 : known ? 400 : 503).json({
        success: false,
        error:
          error.message === 'notfound'
            ? 'Объект не найден'
            : known
              ? error.message
              : 'Операция недоступна. Проверьте состояние сервисов.',
      });
    }
  };
  const saveSubscription = async (input, groupId) => {
    const entries = typeof input === 'string' ? [input] : input;
    const inputs = Array.isArray(entries)
      ? entries.map((entry) => (typeof entry === 'string' ? { url: entry, copies: 1 } : entry))
      : [];
    const urls = inputs.map((entry) => entry?.url);
    if (
      !Array.isArray(entries) ||
      !urls.length ||
      urls.length > 50 ||
      urls.some((url) => typeof url !== 'string' || !url.trim())
    ) {
      throw Error('Подписка: укажите от 1 до 50 ссылок');
    }
    if (
      inputs.some(
        (entry) => !Number.isInteger(entry.copies) || entry.copies < 1 || entry.copies > 100
      )
    ) {
      throw Error('Подписка: число копий должно быть целым от 1 до 100');
    }
    const results = [];
    for (let i = 0; i < urls.length; i += 4) {
      results.push(
        ...(await Promise.allSettled(
          urls.slice(i, i + 4).map(async (url) => parseSubscription(await fetchSub(url.trim())))
        ))
      );
    }
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            `Подписка ${index + 1}: ${/^(Запись \d+:|Подписка|Ожидается|Неподдерживаем|Не удалось загрузить|Сервер подписки|Некоррект|Нуж|Слишком много)/.test(result.reason?.message || '') ? result.reason.message : 'Не удалось обработать источник'}`,
          ]
        : []
    );
    if (failures.length) {
      throw Error(failures.join('; '));
    }
    if (
      results.reduce((sum, result, index) => sum + result.value.length * inputs[index].copies, 0) >
      50000
    ) {
      throw Error('Подписка: итоговый набор превышает 50000 подключений');
    }
    const records = results.flatMap((result, index) =>
      Array.from({ length: inputs[index].copies }, (_, copy) =>
        result.value.map((p) => ({ ...p, id: randomUUID(), source: index + 1, copy: copy + 1 }))
      ).flat()
    );
    const sources = results.map((result, index) => ({
      position: index + 1,
      count: result.value.length * inputs[index].copies,
      originalCount: result.value.length,
      copies: inputs[index].copies,
      sourceFormat: result.value[0].sourceFormat || 'vless-links',
      sourceConfigurations: result.value[0].sourceConfigurations || result.value.length,
      auxiliaryOutbounds: result.value[0].auxiliaryOutbounds || 0,
    }));
    const payload = {
      sources: inputs.map((input) => ({ url: input.url.trim(), copies: input.copies })),
      urls: urls.map((url) => url.trim()),
      records,
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > 10 * 1024 * 1024 || records.length > 50000) {
      throw Error('Подписка: итоговый набор превышает 10 MiB или 50000 подключений');
    }
    return store.save({
      kind: 'subscription',
      groupId,
      metadata: {
        name: `${sources.length} подписок · ${records.length} подключений`,
        count: records.length,
        sources,
        sourceFormat:
          new Set(sources.map((source) => source.sourceFormat)).size === 1
            ? sources[0].sourceFormat
            : 'mixed',
        sourceConfigurations: sources.reduce((sum, source) => sum + source.sourceConfigurations, 0),
        profiles: records.map((p, i) => ({
          id: p.id,
          source: p.source,
          copy: p.copy,
          name: p.name,
          position: i + 1,
          server: `${p.host}:${p.port}`,
          network: p.network,
          security: p.security,
        })),
      },
      payload,
    });
  };
  router.get(
    '/subscriptions',
    route(async (req, res) => {
      const checks = await store.list('availability');
      res.json({
        success: true,
        data: (await store.list('subscription')).map((sub) => ({
          ...sub,
          availability: checks.find((check) => check.subscriptionId === sub.id) || null,
          usable: !sub.profiles?.some((p) => /^(0\.0\.0\.0:|\[?::\]?:)/.test(p.server)),
        })),
      });
    })
  );
  router.post(
    '/subscriptions/:id/check',
    route(async (req, res) => {
      const sub = await store.get(req.params.id, 'subscription');
      assertUsableProfiles(sub.payload.records);
      const load = validateLoad(
        {
          mode: 'vus',
          budget: sub.payload.records.length,
          duration: 1,
          maxVusPerWorker: 1,
          realityFingerprint: req.body.fingerprint || 'subscription',
        },
        'curl',
        sub.payload.records.length
      );
      const run = await store.enqueue({
        requestKey: randomUUID(),
        profiles: sub.payload.records,
        scenario: {
          kind: 'curl',
          request: {
            url: 'https://api.ipify.org?format=json',
            method: 'GET',
            headers: {},
            body: null,
          },
        },
        load,
        metadata: {
          name: 'Проверка VPN подписки',
          purpose: 'subscription-check',
          subscriptionId: sub.metadata.id,
          count: sub.payload.records.length,
          profiles: sub.metadata.profiles,
          load,
        },
      });
      await notify(run.id).catch(() => {});
      res.status(202).json({ success: true, data: run });
    })
  );
  router.post(
    '/subscriptions',
    route(async (req, res) =>
      res.status(201).json({
        success: true,
        data: await saveSubscription(req.body.sources ?? req.body.urls ?? req.body.url),
      })
    )
  );
  router.post(
    '/subscriptions/:id/refresh',
    route(async (req, res) => {
      const old = await store.get(req.params.id, 'subscription');
      res.status(201).json({
        success: true,
        data: await saveSubscription(
          old.payload.sources ?? old.payload.urls ?? old.payload.url,
          old.groupId
        ),
      });
    })
  );
  router.post(
    '/parse-curl',
    route(async (req, res) => res.json({ success: true, data: parseCurl(req.body.curl) }))
  );
  router.get(
    '/scenarios',
    route(async (req, res) => res.json({ success: true, data: await store.list('scenario') }))
  );
  router.get(
    '/scenarios/:id',
    route(async (req, res) =>
      res.json({ success: true, data: (await store.get(req.params.id, 'scenario')).payload })
    )
  );
  router.post(
    '/scenarios',
    route(async (req, res) => {
      const { kind } = req.body;
      if (!['curl', 'js'].includes(kind)) {
        throw Error('Неподдерживаемый сценарий');
      }
      const payload =
        kind === 'curl'
          ? { kind, request: validateRequest(req.body.request) }
          : { kind, source: validateScript(req.body.source) };
      const metadata = await store.save({
        kind: 'scenario',
        metadata: { kind, name: String(req.body.name || 'Новый сценарий').slice(0, 120) },
        payload,
      });
      res.status(201).json({ success: true, data: metadata });
    })
  );
  router.get(
    '/runs',
    route(async (req, res) => res.json({ success: true, data: await store.runs() }))
  );
  router.post(
    '/runs',
    route(async (req, res) => {
      const sub = await store.get(req.body.subscriptionId, 'subscription');
      assertUsableProfiles(sub.payload.records);
      const scenario = await store.get(req.body.scenarioId, 'scenario');
      const load = validateLoad(req.body.load, scenario.payload.kind, sub.payload.records.length);
      let profiles = sub.payload.records,
        connectionCheck;
      if (req.body.requireVerified === true) {
        const checks = await store.list('availability');
        connectionCheck = checks.find(
          (check) =>
            check.subscriptionId === sub.metadata.id &&
            check.fingerprint === load.realityFingerprint
        );
        const verified = selectVerifiedProfiles(
          profiles,
          connectionCheck,
          sub.metadata.id,
          load.realityFingerprint
        );
        profiles = verified.profiles;
        load.prechecked = { checkedAt: connectionCheck.checkedAt, ips: verified.ips };
      }
      const requestKey = req.get('Idempotency-Key') || randomUUID();
      if (!/^[\w-]{1,100}$/.test(requestKey)) {
        throw Error('Некорректный ключ запроса');
      }
      const run = await store.enqueue({
        requestKey,
        profiles,
        scenario: scenario.payload,
        load,
        metadata: {
          subscriptionId: sub.metadata.id,
          scenarioId: scenario.metadata.id,
          name: scenario.metadata.name,
          kind: scenario.payload.kind,
          expectedStatus: scenario.payload.request?.expectedStatus ?? null,
          cacheBust: scenario.payload.request?.cacheBust || false,
          count: sub.payload.records.length,
          load,
          profiles: sub.metadata.profiles,
          ...(connectionCheck ? { connectionCheck, eligibleCount: profiles.length } : {}),
        },
      });
      await notify(run.id).catch(() => {});
      res.status(202).json({ success: true, data: run });
    })
  );
  router.get(
    '/runs/:id',
    route(async (req, res) => res.json({ success: true, data: await store.run(req.params.id) }))
  );
  router.post(
    '/runs/:id/stop',
    route(async (req, res) => res.json({ success: true, data: await store.cancel(req.params.id) }))
  );
  router.get(
    '/runs/:id/metrics',
    route(async (req, res) => {
      await store.run(req.params.id);
      res.json({ success: true, data: await metrics(req.params.id) });
    })
  );
  router.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const inFlight = new Set();
    const send = async () => {
      if (inFlight.size || res.destroyed) {
        return;
      }
      inFlight.add('send');
      try {
        const data = await store.runs();
        const active = data.find((run) => ['preparing', 'running', 'stopping'].includes(run.state));
        let live = null,
          metricsError = false;
        if (active) {
          try {
            live = { runId: active.id, workers: await metrics(active.id), updatedAt: Date.now() };
          } catch {
            metricsError = true;
          }
        }
        if (!res.destroyed) {
          res.write(`data: ${JSON.stringify({ runs: data, live, metricsError })}\n\n`);
        }
      } catch {
        if (!res.destroyed) {
          res.write('event: unavailable\ndata: {}\n\n');
        }
      } finally {
        inFlight.delete('send');
      }
    };
    const timer = setInterval(send, 2000);
    const expiry = setTimeout(() => res.end(), 5 * 60 * 1000);
    req.on('close', () => {
      clearInterval(timer);
      clearTimeout(expiry);
    });
    void send();
  });
  return router;
}
