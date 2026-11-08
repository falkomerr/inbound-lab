# Разработка

Нужны Python 3.11+, Node.js 22 и Bun 1.3.14. Рабочая директория Node-приложения находится в `platform/`.

```bash
cd platform
bun install --frozen-lockfile
bun run test
bun run lint
bun run build:ui
bunx vite build --config vite.vpn.config.js
```

VPN unit-тесты используют синтетические записи. Генератор публикации и HTTP-приёмник проверяются отдельно командами из README. Не добавляйте реальные подписки и не направляйте CI-нагрузку на публичные сервисы.

## Контейнерный стенд

На отдельном Docker-хосте, где нет рабочего теста:

```bash
python3 scripts/init-secrets.py
docker compose --profile build build api worker-image
docker compose --profile build pull xray-image
docker compose -f compose.yaml -f compose.test.yaml up -d
DOCKER_SOCKET=/var/run/docker.sock node platform/tests/docker/smoke.mjs
DOCKER_SOCKET=/var/run/docker.sock node platform/tests/docker/network.mjs
```

На macOS задайте путь к сокету своего Docker-контекста через `DOCKER_SOCKET`. Не используйте чужой Docker socket. Тестовый override перенаправляет проверку туннеля на локальную fixture-цель. Для настоящего запуска используйте основной compose без override.

После проверки остановите только сервисы тестового проекта:

```bash
docker compose -f compose.yaml -f compose.test.yaml stop
```

Секреты и Docker volumes сохраняются. Удаление volumes может уничтожить данные, поэтому в обычную очистку не входит. Внешние IPv4/IPv6-запросы в сетевой проверке служат отрицательными пробами отсутствия прямого выхода.

## Изменения и релиз

Проверяйте поведение на AMD64/ARM64 отдельно. Обновляйте `bun.lock` и используйте frozen lockfile. Не переформатируйте несвязанный upstream-код. Присылайте воспроизводимое описание, тесты для существенной логики и ограничения проверки. Прежде чем переносить изменения в новый GitHub-репозиторий, выполните экспорт и прочитайте `PUBLICATION_MANIFEST.json`. Не включайте рабочую Git-историю, личные отчёты и снимки панели с VPN-данными.
