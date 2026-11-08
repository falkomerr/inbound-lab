<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { createVariables } from '../server/vpn/request.js';
import { availabilityTtl } from '../server/vpn/availability-ui.js';

const subscriptions = ref([]),
  scenarios = ref([]),
  runs = ref([]),
  live = ref([]);
const subscriptionId = ref(''),
  scenarioId = ref(''),
  selectedRun = ref('');
const urls = ref([{ url: '', copies: 1 }]),
  curl = ref(''),
  source = ref('');
const kind = ref('curl'),
  name = ref('Новый тест'),
  headers = ref('{}');
const request = ref({ url: '', method: 'GET', body: null, cacheBust: false, expectedStatus: null });
const load = ref({
  mode: 'rps',
  budget: 200,
  duration: 60,
  maxErrorRate: 0.01,
  maxP95: 1000,
  maxVusPerWorker: 20,
  realityFingerprint: 'subscription',
  skipUnavailable: true,
});
const error = ref(''),
  notice = ref(''),
  busy = ref(false),
  connected = ref(false);
const theme = ref(localStorage.getItem('vpnTheme') || 'light');
const controller = new AbortController();
let metricTimer;
const metricsError = ref(false),
  metricsUpdated = ref(null);
let pendingLaunch = null;
let savedDraft = null;
const step = ref(1);
const steps = [
  {
    number: 1,
    label: 'VPN',
    title: 'Подключите VPN',
    description:
      'Импортируйте подписки. Подключения, которым не хватит памяти, пройдут следующими партиями.',
  },
  {
    number: 2,
    label: 'Сценарий',
    title: 'Подготовьте запросы',
    description: 'Вставьте cURL или загрузите JS-файл, затем задайте общую нагрузку.',
  },
  {
    number: 3,
    label: 'Метрики',
    title: 'Наблюдайте за тестом',
    description: 'Живые метрики с отправителя, отдельно по каждому воркеру.',
  },
];
const canRun = computed(
  () =>
    subscription.value &&
    verified.value &&
    !checking.value &&
    name.value.trim() &&
    load.value.budget >= 1 &&
    (kind.value === 'js' ? source.value.trim() : request.value.url || curl.value.trim())
);
watch(step, async () => {
  await nextTick();
  document.getElementById('step-title')?.focus();
  window.scrollTo(0, 0);
});
const subscription = computed(() =>
  subscriptions.value.find((x) => x.id === subscriptionId.value && x.usable !== false)
);
const isDemo = (sub) =>
  Boolean(sub?.profiles?.length && sub.profiles.every((p) => p.server.startsWith('fixture-xray:')));
const run = computed(() => runs.value.find((x) => x.id === selectedRun.value) || runs.value[0]);
const active = (state) => ['queued', 'preparing', 'running', 'stopping'].includes(state);
const checking = computed(() =>
  runs.value.find(
    (r) =>
      r.purpose === 'subscription-check' &&
      r.subscriptionId === subscriptionId.value &&
      active(r.state)
  )
);
const availability = computed(() => subscription.value?.availability);
const verified = computed(
  () =>
    availability.value?.complete &&
    availability.value.ready > 0 &&
    availability.value.fingerprint === load.value.realityFingerprint &&
    Date.now() - availability.value.checkedAt < availabilityTtl
);
const checkProgress = computed(() => checking.value?.connectionCheck || availability.value);
const checkResults = computed(
  () => new Map((checkProgress.value?.results || []).map((r) => [r.id, r]))
);
watch(
  () =>
    runs.value
      .filter((r) => r.purpose === 'subscription-check' && r.state === 'completed')
      .map((r) => r.id)
      .join(','),
  async () => {
    subscriptions.value = await api('/subscriptions');
  }
);
const states = {
  queued: 'В очереди',
  preparing: 'Подготовка',
  running: 'Выполняется',
  stopping: 'Остановка',
  completed: 'Завершён',
  failed: 'Ошибка',
  cancelled: 'Отменён',
  interrupted: 'Прерван',
};
const numberFormat = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 });
const fmt = (value) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? 'нет данных'
    : numberFormat.format(value);
const timestamp = (value) => new Date(value).toLocaleString('ru');
const totalRps = computed(() =>
  live.value.length
    ? live.value.reduce(
        (sum, x) =>
          sum +
          (run.value?.rotation
            ? run.value.rotation.activeIds.includes(x.id)
              ? x.rps || 0
              : 0
            : x.rps || 0),
        0
      )
    : null
);
const workerMap = computed(() => {
  const values = new Map(
    (run.value?.connectionCheck?.results || []).map((worker) => [worker.id, worker])
  );
  for (const worker of live.value) values.set(worker.id, { ...values.get(worker.id), ...worker });
  for (const worker of run.value?.workers || [])
    values.set(worker.id, { ...values.get(worker.id), ...worker });
  return values;
});
const total = (field) =>
  workerMap.value.size
    ? [...workerMap.value.values()].reduce((sum, worker) => sum + (worker[field] || 0), 0)
    : null;
const worker = (id) => workerMap.value.get(id) || {};
const workerState = (id) =>
  worker(id).status === 'failed'
    ? 'Ошибка VPN'
    : worker(id).status === 'completed'
      ? 'Завершён'
      : worker(id).status === 'interrupted'
        ? 'Прерван'
        : run.value?.rotation?.activeIds.includes(id)
          ? states[run.value.state]
          : worker(id).status === 'ready' && active(run.value.state)
            ? 'Готов, ожидает'
            : active(run.value.state)
              ? 'Ожидает'
              : 'Не запускался';

async function api(path, body, key, signal) {
  const response = await fetch(`/api/vpn${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (response.status === 401) {
    localStorage.removeItem('authToken');
    location.assign('/login');
    throw Error('Требуется вход');
  }
  if (path === '/events' && response.ok) return response;
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Ошибка запроса');
  return data.data;
}

async function action(fn) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function refresh() {
  [subscriptions.value, scenarios.value, runs.value] = await Promise.all([
    api('/subscriptions'),
    api('/scenarios'),
    api('/runs'),
  ]);
  subscriptionId.value ||= subscriptions.value.find((sub) => sub.usable !== false)?.id || '';
  selectedRun.value ||= runs.value.find((r) => active(r.state))?.id || runs.value[0]?.id || '';
}

function importSubscription() {
  void action(async () => {
    let saved;
    try {
      saved = await api('/subscriptions', {
        sources: urls.value
          .filter((source) => source.url.trim())
          .map((source) => ({ url: source.url.trim(), copies: source.copies })),
      });
    } catch (failure) {
      subscriptionId.value = '';
      throw failure;
    }
    urls.value = [{ url: '', copies: 1 }];
    subscriptionId.value = saved.id;
    await refresh();
    notice.value = `Импортировано ${saved.count} подключений. При нехватке памяти они пройдут партиями.`;
    await enqueueSubscriptionCheck();
  });
}

function refreshSubscription() {
  void action(async () => {
    const saved = await api(`/subscriptions/${subscriptionId.value}/refresh`, {});
    subscriptionId.value = saved.id;
    await refresh();
    notice.value = 'Сохранена новая версия подписки';
    await enqueueSubscriptionCheck();
  });
}

async function enqueueSubscriptionCheck() {
  if (checking.value) return;
  await api(`/subscriptions/${subscriptionId.value}/check`, {
    fingerprint: load.value.realityFingerprint,
  });
  await refresh();
  notice.value =
    'Проверяем подписку без нагрузки на тестируемый сервис. Результат действителен 15 минут.';
}
function checkVpn() {
  void action(enqueueSubscriptionCheck);
}

function parseCurl() {
  void action(async () => {
    const parsed = await api('/parse-curl', { curl: curl.value });
    headers.value = JSON.stringify(parsed.headers, null, 2);
    request.value = {
      ...parsed,
      cacheBust: request.value.cacheBust || false,
      expectedStatus: request.value.expectedStatus ?? null,
    };
    curl.value = '';
    notice.value = 'Запрос импортирован. Проверьте его перед сохранением.';
  });
}

async function persistScenario() {
  if (kind.value === 'curl' && curl.value.trim()) {
    const parsed = await api('/parse-curl', { curl: curl.value });
    headers.value = JSON.stringify(parsed.headers, null, 2);
    request.value = {
      ...parsed,
      cacheBust: request.value.cacheBust || false,
      expectedStatus: request.value.expectedStatus ?? null,
    };
    curl.value = '';
  }
  const payload =
    kind.value === 'js'
      ? { source: source.value }
      : { request: { ...request.value, headers: JSON.parse(headers.value) } };
  const draft = { kind: kind.value, name: name.value, ...payload };
  const signature = JSON.stringify(draft);
  if (savedDraft?.signature === signature) return savedDraft.id;
  const saved = await api('/scenarios', draft);
  scenarioId.value = saved.id;
  savedDraft = { signature, id: saved.id };
  return saved.id;
}

function saveScenario() {
  void action(async () => {
    await persistScenario();
    await refresh();
    notice.value = 'Сохранена новая версия сценария';
  });
}

function editScenario() {
  if (!scenarioId.value) {
    name.value = 'Новый тест';
    request.value = { url: '', method: 'GET', body: null, cacheBust: false, expectedStatus: null };
    headers.value = '{}';
    source.value = '';
    curl.value = '';
    savedDraft = null;
    return;
  }
  void action(async () => {
    const saved = await api(`/scenarios/${scenarioId.value}`);
    kind.value = saved.kind;
    name.value = scenarios.value.find((s) => s.id === scenarioId.value)?.name || '';
    if (saved.kind === 'js') source.value = saved.source;
    else {
      request.value = saved.request;
      headers.value = JSON.stringify(saved.request.headers, null, 2);
    }
  });
}

function start() {
  void action(async () => {
    const savedId = await persistScenario();
    const mode = load.value.mode === 'vus' ? 'vus' : kind.value === 'js' ? 'iterations' : 'rps';
    const payload = {
      subscriptionId: subscriptionId.value,
      scenarioId: savedId,
      requireVerified: true,
      load: { ...load.value, mode },
    };
    const signature = JSON.stringify(payload);
    if (!pendingLaunch || pendingLaunch.signature !== signature)
      pendingLaunch = {
        signature,
        key: createVariables(crypto.getRandomValues(new Uint8Array(20)), Date.now())['random.uuid'],
      };
    const created = await api('/runs', payload, pendingLaunch.key);
    pendingLaunch = null;
    selectedRun.value = created.id;
    live.value = [];
    metricsUpdated.value = null;
    step.value = 3;
    await refresh();
    notice.value = 'Тест добавлен в очередь';
  });
}

function stop() {
  if (run.value)
    void action(async () => {
      await api(`/runs/${run.value.id}/stop`, {});
      await refresh();
    });
}
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme.value;
  localStorage.setItem('vpnTheme', theme.value);
}
async function upload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 262144) {
    error.value = 'JS превышает 256 KiB';
    return;
  }
  source.value = await file.text();
  if (name.value === 'Новый тест') name.value = file.name.replace(/\.js$/i, '');
}
function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
  location.assign('/login');
}
function download() {
  const blob = new Blob([JSON.stringify(run.value, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `run-${run.value.id}.json`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

async function events() {
  while (!controller.signal.aborted) {
    try {
      const response = await api('/events', undefined, undefined, controller.signal);
      connected.value = true;
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (frame.startsWith('data: ')) {
            const update = JSON.parse(frame.slice(6));
            runs.value = update.runs;
            metricsError.value = update.metricsError;
            if (update.live?.runId === run.value?.id) {
              live.value = update.live.workers || [];
              metricsUpdated.value = update.live.updatedAt;
            }
          } else if (frame.includes('unavailable')) connected.value = false;
        }
      }
    } catch {
      connected.value = false;
    }
    if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

onMounted(async () => {
  document.documentElement.dataset.theme = theme.value;
  await action(refresh);
  if (runs.value.some((r) => active(r.state) && r.purpose !== 'subscription-check')) step.value = 3;
  void events();
  metricTimer = setInterval(async () => {
    if (!run.value || active(run.value.state)) return;
    const id = run.value.id;
    try {
      const result = await api(`/runs/${id}/metrics`);
      if (run.value?.id === id) live.value = result || [];
    } catch {
      live.value = [];
    }
  }, 10000);
});
onBeforeUnmount(() => {
  controller.abort();
  clearInterval(metricTimer);
});
</script>

<template>
  <div class="lab-shell">
    <header class="lab-header">
      <a class="lab-brand" href="#" @click.prevent="step = 1">INBOUND<span>LAB</span></a>
      <span class="lab-caption">Нагрузочные тесты через VPN</span>
      <div class="lab-header-actions">
        <span :class="['lab-connection', { online: connected }]">{{
          connected ? 'Подключено' : 'Нет обновлений'
        }}</span>
        <button v-if="runs.length" @click="step = 3">История тестов</button>
        <button @click="toggleTheme" aria-label="Переключить тему">
          {{ theme === 'dark' ? 'Светлая тема' : 'Тёмная тема' }}
        </button>
        <button @click="logout">Выйти</button>
      </div>
    </header>
    <main>
      <nav class="lab-stepper" aria-label="Шаги создания теста">
        <button
          v-for="item in steps"
          :key="item.number"
          :class="[
            'lab-step-button',
            { current: step === item.number, complete: step > item.number },
          ]"
          :disabled="
            busy || (item.number === 2 && !subscription) || (item.number === 3 && !runs.length)
          "
          :aria-current="step === item.number ? 'step' : undefined"
          @click="step = item.number"
        >
          <span class="lab-step-index">{{ item.number }}</span
          ><span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="lab-title lab-wizard-title">
        <div>
          <p class="lab-eyebrow">ШАГ {{ step }} ИЗ 3</p>
          <h1 id="step-title" tabindex="-1">{{ steps[step - 1].title }}</h1>
          <p>{{ steps[step - 1].description }}</p>
        </div>
        <span class="lab-vpn-count" v-if="step === 3 ? run : subscription"
          >{{ step === 3 ? run.count : subscription.count }} подключений · только VPN</span
        >
      </div>
      <div v-if="error" class="lab-alert error" role="alert">{{ error }}</div>
      <div v-if="notice" class="lab-alert" role="status">{{ notice }}</div>

      <section v-if="step === 1" class="lab-panel lab-vpn-stage">
        <div class="lab-vpn-import">
          <h2>VPN-подписки</h2>
          <p class="lab-muted">
            Добавьте ссылки на подписки. Все их подключения войдут в один тест.
          </p>
          <form @submit.prevent="importSubscription">
            <div v-for="(_, index) in urls" :key="index">
              <label
                >Подписка {{ index + 1
                }}<input
                  v-model="urls[index].url"
                  type="password"
                  autocomplete="off"
                  placeholder="https://…"
                  required
              /></label>
              <label
                >Копий<input
                  v-model.number="urls[index].copies"
                  type="number"
                  min="1"
                  max="100"
                  required
              /></label>
              <button
                v-if="urls.length > 1"
                type="button"
                :disabled="busy"
                @click="urls.splice(index, 1)"
              >
                Удалить ссылку {{ index + 1 }}
              </button>
            </div>
            <button
              type="button"
              :disabled="busy || urls.length >= 50"
              @click="urls.push({ url: '', copies: 1 })"
            >
              Добавить ссылку
            </button>
            <button class="primary" :disabled="busy || !urls.some((source) => source.url.trim())">
              Импортировать все
            </button>
          </form>
          <div class="lab-saved-subscription">
            <label
              >Или сохранённая версия<select v-model="subscriptionId">
                <option value="" disabled>Выберите подписку</option>
                <option
                  v-for="s in subscriptions"
                  :key="s.id"
                  :value="s.id"
                  :disabled="s.usable === false"
                >
                  {{ s.usable === false ? 'Служебная заглушка · ' : '' }}
                  {{ s.sources?.length > 1 ? `${s.sources.length} подписок · ` : '' }}
                  {{ isDemo(s) ? 'Тестовый стенд · ' : '' }}{{ s.count }} подключений ·
                  {{ timestamp(s.created) }}
                </option>
              </select></label
            >
            <button @click="refreshSubscription" :disabled="!subscriptionId || busy">
              Обновить все источники
            </button>
          </div>
          <p class="lab-muted">
            Обновление сохраняет новую версию. Выполняющийся тест продолжит использовать свою версию
            подписки.
          </p>
          <label
            >Отпечаток для проверки VPN<select
              v-model="load.realityFingerprint"
              :disabled="Boolean(checking)"
            >
              <option value="subscription">Из подписки</option>
              <option value="firefox">Firefox</option>
              <option value="chrome">Chrome</option>
              <option value="safari">Safari</option>
            </select></label
          >
          <button @click="checkVpn" :disabled="!subscription || busy || Boolean(checking)">
            {{ checking ? 'Проверяем VPN…' : 'Проверить доступность VPN' }}
          </button>
          <p v-if="checking && !checkProgress" class="lab-alert">
            Проверка в очереди. Нагрузка не запускается.
          </p>
          <p v-if="checkProgress" class="lab-alert">
            Проверено {{ checkProgress.checked }} из {{ subscription.count }}. Доступно
            {{ checkProgress.ready }}, недоступно {{ checkProgress.failed }}.
            <template v-if="verified"
              >В тест попадут только доступные. Проверено
              {{ timestamp(availability.checkedAt) }}.</template
            >
            <template v-else-if="!checking"
              >Для запуска нужна свежая проверка с выбранным отпечатком.</template
            >
          </p>
        </div>
        <div class="lab-vpn-preview">
          <p v-for="source in subscription?.sources || []" :key="source.position" class="lab-muted">
            Подписка {{ source.position }} · {{ source.count }} подключений ·
            <span v-if="source.copies > 1"
              >{{ source.originalCount }} × {{ source.copies }} копии ·
            </span>
            {{ source.sourceFormat === 'xray-json' ? 'Xray JSON' : 'VLESS' }}
            <span v-if="source.auxiliaryOutbounds">
              · {{ source.auxiliaryOutbounds }} служебных маршрутов (не VPN-серверы)</span
            >
          </p>
          <p v-if="isDemo(subscription)" class="lab-alert">
            Выбрана тестовая подписка локального стенда. Импортируйте свою ссылку для реальных
            подключений.
          </p>
          <p v-else-if="subscription?.sourceFormat" class="lab-muted">
            {{
              subscription.sourceFormat === 'xray-json'
                ? 'Конфигурация Xray JSON'
                : subscription.sourceFormat === 'mixed'
                  ? 'Xray JSON и VLESS'
                  : 'Список VLESS'
            }}
            · серверных подключений: {{ subscription.count }}
          </p>
          <div class="lab-panel-title">
            <h2>Подключения</h2>
            <span v-if="subscription" class="lab-tag"
              >{{ subscription.count }} из {{ subscription.count }}</span
            >
          </div>
          <p class="lab-muted">
            Сначала проверьте все записи. В нагрузку попадут доступные подключения, включая записи с
            одинаковым внешним IP. Недоступные останутся в списке с результатом проверки.
          </p>
          <div class="lab-profile-list">
            <div v-for="p in subscription?.profiles || []" :key="p.id" class="lab-profile">
              <span class="lab-number">{{ p.position }}</span>
              <div>
                <strong>{{ p.name }}</strong
                ><small
                  ><template v-if="p.source"
                    >Подписка {{ p.source }} · копия {{ p.copy || 1 }} · </template
                  >{{ p.server }}</small
                >
              </div>
              <span class="lab-tag">{{ p.network }} / {{ p.security }}</span>
              <span class="lab-tag">{{
                checkResults.get(p.id)?.status === 'ready'
                  ? 'Доступен'
                  : checkResults.get(p.id)?.status === 'failed'
                    ? 'Недоступен'
                    : 'Не проверен'
              }}</span>
            </div>
            <p v-if="!subscription" class="lab-empty">
              Импортируйте подписку, чтобы увидеть подключения
            </p>
          </div>
        </div>
        <div class="lab-wizard-actions">
          <span class="lab-muted">Следующий шаг: cURL или JS-файл</span
          ><button
            class="primary"
            @click="
              step = 2;
              notice = '';
            "
            :disabled="!subscription || busy || !verified || Boolean(checking)"
          >
            Далее: сценарий →
          </button>
        </div>
      </section>

      <div v-if="step === 2" class="lab-config-grid">
        <section class="lab-panel">
          <div class="lab-panel-title">
            <h2>Что тестируем</h2>
            <div class="lab-segment">
              <button :class="{ chosen: kind === 'curl' }" @click="kind = 'curl'">
                cURL / форма</button
              ><button :class="{ chosen: kind === 'js' }" @click="kind = 'js'">JS-файл</button>
            </div>
          </div>
          <label
            >Сохранённый сценарий<select v-model="scenarioId" @change="editScenario">
              <option value="">Новый сценарий</option>
              <option v-for="s in scenarios" :key="s.id" :value="s.id">
                {{ s.name }} · {{ s.kind }}
              </option>
            </select></label
          >
          <label
            >Название теста<input
              v-model="name"
              maxlength="120"
              placeholder="Например, API каталога"
          /></label>
          <template v-if="kind === 'curl'">
            <label
              >Вставьте cURL<textarea
                v-model="curl"
                class="lab-code"
                rows="4"
                spellcheck="false"
                placeholder="curl 'https://your-service.example/api'"
              ></textarea>
            </label>
            <button @click="parseCurl" :disabled="!curl || busy">
              Разобрать и проверить запрос
            </button>
            <p class="lab-muted">
              При запуске cURL будет разобран автоматически. Можно сразу заполнить форму ниже.
            </p>
            <div class="lab-inline">
              <label
                >Метод<select v-model="request.method">
                  <option
                    v-for="method in ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']"
                    :key="method"
                  >
                    {{ method }}
                  </option>
                </select></label
              ><label class="lab-grow"
                >URL запроса<input
                  v-model="request.url"
                  type="url"
                  placeholder="https://your-service.example/api"
              /></label>
            </div>
            <label class="lab-toggle"
              ><input v-model="request.cacheBust" type="checkbox" />Уникальный URL для каждого
              запроса</label
            >
            <p class="lab-muted">
              Добавляет случайный query-параметр и заголовки no-cache. Логин и пароль сохраняются,
              если в них нет переменных.
            </p>
            <label
              >Ожидаемый HTTP-статус<input
                v-model.number="request.expectedStatus"
                type="number"
                min="100"
                max="599"
                placeholder="По умолчанию 200–399"
            /></label>
            <p class="lab-muted">
              В URL, заголовках и теле доступны <code v-pre>{{ random.uuid }}</code
              >, <code v-pre>{{ random.int }}</code> и <code v-pre>{{ timestamp }}</code
              >. Новые значения создаются для каждого запроса.
            </p>
            <details class="lab-advanced" :open="Boolean(request.body) || headers !== '{}'">
              <summary>Заголовки и тело запроса</summary>
              <label
                >Заголовки (JSON)<textarea
                  v-model="headers"
                  class="lab-code"
                  rows="3"
                  spellcheck="false"
                ></textarea>
              </label>
              <label
                >Тело запроса<textarea
                  v-model="request.body"
                  class="lab-code"
                  rows="3"
                  spellcheck="false"
                ></textarea>
              </label>
            </details>
          </template>
          <template v-else>
            <label class="lab-file-drop"
              >JS-файл сценария<input
                type="file"
                accept=".js,text/javascript"
                @change="upload"
              /><span class="lab-muted"
                >Один файл до 256 KiB, с функцией export default.</span
              ></label
            >
            <label
              >Код сценария<textarea
                v-model="source"
                class="lab-code"
                rows="12"
                spellcheck="false"
                placeholder="Загрузите JS-файл или вставьте код"
              ></textarea>
            </label>
            <p class="lab-muted">
              Доступны встроенные модули k6. Интенсивность и длительность задаются справа.
            </p>
          </template>
        </section>
        <aside class="lab-panel lab-load-panel">
          <h2>Нагрузка</h2>
          <div class="lab-budget-summary">
            <strong>{{ subscription.count }}</strong
            ><span>подключений всего</span
            ><small>Размер партии определяется по доступной памяти</small>
          </div>
          <label
            >Режим<select v-model="load.mode">
              <option value="rps">
                {{ kind === 'js' ? 'Итерации/с суммарно' : 'RPS суммарно' }}
              </option>
              <option value="vus">VU суммарно</option>
            </select></label
          >
          <div class="lab-load-fields">
            <label
              >Общий бюджет<input
                v-model.number="load.budget"
                type="number"
                min="1"
                max="10000" /></label
            ><label
              >Время на подключение, с<input
                v-model.number="load.duration"
                type="number"
                min="1"
                max="86400"
            /></label>
          </div>
          <p class="lab-muted">
            Общий бюджет делится между активными подключениями. Каждое работает
            {{ load.duration }} с. Полное время теста зависит от числа партий и подготовки VPN.
          </p>
          <details class="lab-advanced">
            <summary>Лимиты и пороги</summary>
            <label class="lab-toggle"
              ><input v-model="load.skipUnavailable" type="checkbox" />Продолжать через доступные
              VPN, остальные отмечать ошибкой</label
            >
            <label
              >Отпечаток REALITY<select v-model="load.realityFingerprint">
                <option value="subscription">Из подписки</option>
                <option value="firefox">Firefox</option>
                <option value="chrome">Chrome</option>
                <option value="safari">Safari</option>
              </select></label
            >
            <p class="lab-muted">
              Меняет только клиентский TLS-отпечаток REALITY для этого запуска. Параметры исходной
              подписки сохраняются.
            </p>
            <label v-if="load.mode !== 'vus'"
              >Максимум VU на воркер<input
                v-model.number="load.maxVusPerWorker"
                type="number"
                min="1"
                max="1000"
            /></label>
            <p v-if="load.mode !== 'vus'" class="lab-muted">
              Начинаем с одного VU. Если лимита не хватит для заданной интенсивности, пропущенные
              итерации будут видны в отчёте.
            </p>
            <label
              >Максимальная доля HTTP-ошибок<input
                v-model.number="load.maxErrorRate"
                type="number"
                min="0"
                max="1"
                step="0.01" /></label
            ><label
              >Порог p95, мс<input v-model.number="load.maxP95" type="number" min="1"
            /></label>
          </details>
          <div class="lab-start-actions">
            <button class="primary" @click="start" :disabled="busy || !canRun">
              {{ busy ? 'Подготовка…' : 'Запустить тест →' }}</button
            ><button @click="saveScenario" :disabled="busy || !canRun">Сохранить без запуска</button
            ><button @click="step = 1" :disabled="busy">← Назад к VPN</button>
          </div>
          <p class="lab-muted">
            Сценарий сохранится автоматически. Затем откроются метрики. Если другой тест уже
            работает, этот запуск попадёт в очередь.
          </p>
        </aside>
      </div>

      <section v-if="step === 3" class="lab-panel lab-metrics-stage">
        <div class="lab-panel-title">
          <h2>Метрики отправителя</h2>
          <button
            @click="
              step = 1;
              notice = '';
            "
          >
            Новый тест
          </button>
        </div>
        <label v-if="runs.length"
          >Запуск<select
            v-model="selectedRun"
            @change="
              live = [];
              metricsUpdated = null;
            "
          >
            <option v-for="r in runs" :key="r.id" :value="r.id">
              {{ r.name }} · {{ states[r.state] }} · {{ timestamp(r.created) }}
            </option>
          </select></label
        >
        <div v-if="run" class="lab-report">
          <div class="lab-panel-title lab-run-toolbar">
            <span class="lab-tag">{{
              run.state === 'completed' && run.connectionCheck?.failed
                ? 'Завершён с недоступными VPN'
                : states[run.state] || run.state
            }}</span
            ><code>{{ run.id.slice(0, 8) }}</code
            ><span class="lab-muted"
              >{{ run.count }} воркера · {{ run.load.budget }}
              {{
                run.load.mode === 'vus'
                  ? 'VU'
                  : run.load.mode === 'iterations'
                    ? 'итераций/с'
                    : 'RPS'
              }}
              суммарно</span
            ><button v-if="active(run.state)" @click="stop" :disabled="busy">
              Остановить весь тест</button
            ><button @click="download">Скачать JSON</button>
          </div>
          <p v-if="run.reason" class="lab-alert error">{{ run.reason }}</p>
          <p v-if="run.expectedStatus" class="lab-muted">
            Ожидаемый результат: HTTP {{ run.expectedStatus
            }}{{ run.expectedStatus === 401 ? ' (отказ в авторизации)' : '' }}. «Успешно» означает
            получение этого статуса.
          </p>
          <p v-if="run.connectionDiagnostics?.length" class="lab-muted">
            Коды проверки VPN: {{ run.connectionDiagnostics.join(', ') }}
          </p>
          <p
            v-if="run.load.realityFingerprint && run.load.realityFingerprint !== 'subscription'"
            class="lab-muted"
          >
            Отпечаток REALITY в этом запуске: {{ run.load.realityFingerprint }}
          </p>
          <p v-if="run.state === 'queued'" class="lab-alert">
            Тест в очереди. Он начнётся после завершения текущего запуска.
          </p>
          <p v-if="run.connectionCheck" class="lab-alert">
            Проверено {{ run.connectionCheck.checked }} из {{ run.connectionCheck.total }}. Готово
            {{ run.connectionCheck.ready }}, недоступно {{ run.connectionCheck.failed }}. Все отказы
            сохранены в таблице.
          </p>
          <p v-if="run.state === 'preparing' && run.rotation?.activeIds.length" class="lab-alert">
            Проверяем VPN и готовность воркеров текущей партии. Подготовлено
            {{ run.preparedCount || 0 }} из {{ run.rotation?.activeIds.length || run.count }}. Её
            нагрузка ещё не началась.
          </p>
          <p v-if="run.rotation?.batch" class="lab-alert">
            Партия {{ run.rotation.batch }} · одновременно до {{ run.rotation.capacity }} ·
            завершено {{ run.rotation.completed }} из {{ run.count }} · по
            {{ run.rotation.durationPerConnection }} с на подключение
          </p>
          <p v-if="metricsError" class="lab-alert error">
            Метрики временно не обновляются. Показаны последние полученные значения.
          </p>
          <div class="lab-stats">
            <div>
              <small>Запросов</small
              ><strong>{{ fmt(run.aggregate?.requests ?? total('requests')) }}</strong>
            </div>
            <div>
              <small>Успешно</small
              ><strong>{{ fmt(run.aggregate?.successful ?? total('successful')) }}</strong>
            </div>
            <div>
              <small>Ошибок</small
              ><strong>{{ fmt(run.aggregate?.errors ?? total('errors')) }}</strong>
            </div>
            <div>
              <small>HTTP RPS сейчас</small><strong>{{ fmt(totalRps) }}</strong>
            </div>
          </div>
          <div class="lab-metric-caption">
            <p class="lab-muted">
              Данные k6 на отправителе. Запрос учитывается после ответа или ошибки.
            </p>
            <p class="lab-muted">
              {{ metricsUpdated ? 'Обновлено ' + timestamp(metricsUpdated) : 'Ожидаем метрики' }} ·
              каждые 2 с
            </p>
          </div>
          <div class="lab-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Воркер / VPN</th>
                  <th>Внешний IP</th>
                  <th>Состояние</th>
                  <th>Запросов</th>
                  <th>Успешно</th>
                  <th>Ошибки HTTP</th>
                  <th>Ошибки сети</th>
                  <th>RPS</th>
                  <th>p95, мс</th>
                  <th>Проверки JS</th>
                  <th>Пропущено итераций</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in run.profiles" :key="p.id">
                  <td>
                    <strong>{{ p.position }}. {{ p.name }}</strong
                    ><small class="lab-worker-endpoint">{{ p.server }}</small>
                  </td>
                  <td class="lab-code">{{ worker(p.id).ip || 'ожидание' }}</td>
                  <td :title="worker(p.id).connectionError">{{ workerState(p.id) }}</td>
                  <td>{{ fmt(worker(p.id).requests) }}</td>
                  <td>{{ fmt(worker(p.id).successful) }}</td>
                  <td>{{ fmt(worker(p.id).httpErrors) }}</td>
                  <td>{{ fmt(worker(p.id).networkErrors) }}</td>
                  <td>{{ fmt(worker(p.id).status === 'completed' ? 0 : worker(p.id).rps) }}</td>
                  <td>{{ fmt(worker(p.id).latency?.['p(95)'] ?? worker(p.id).p95) }}</td>
                  <td>
                    <span v-if="worker(p.id).checksFailed != null"
                      >{{ fmt(worker(p.id).checksPassed) }} успешно /
                      {{ fmt(worker(p.id).checksFailed) }} ошибок</span
                    ><span v-else-if="worker(p.id).checks?.length">{{
                      worker(p.id)
                        .checks.map((check) => `${check.name}: ${fmt(check.successRate * 100)}%`)
                        .join('; ')
                    }}</span
                    ><span v-else>не заданы</span>
                  </td>
                  <td>{{ fmt(worker(p.id).droppedIterations) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="lab-report-footer">
            <p class="lab-muted">
              Пороги:
              {{
                { passed: 'пройдены', failed: 'не пройдены', unavailable: 'недостаточно метрик' }[
                  run.aggregate?.thresholds?.status
                ] || 'ожидают завершения'
              }}.
              {{
                run.aggregate?.p95 != null ? 'Общий p95: ' + fmt(run.aggregate.p95) + ' мс.' : ''
              }}
            </p>
            <button @click="step = 2">← К сценарию</button>
          </div>
        </div>
        <div v-else class="lab-empty">
          <p>Запусков пока нет. Подключите VPN и подготовьте сценарий.</p>
          <button class="primary" @click="step = 1">Начать с VPN</button>
        </div>
      </section>
      <footer class="lab-footer">
        <span>Inbound Lab · на основе FasterTest</span><span>Отчёты 30 дней · метрики 7 дней</span>
      </footer>
    </main>
  </div>
</template>
