# Происхождение стороннего кода

- Репозиторий: https://github.com/alirezaedalat/fastertest
- Коммит: `8c281f43c27d7333db78b79dba5702d6a9fce6db`
- Лицензия приложения: ISC, см. `LICENSE`.
- Копия исходников получена 7 ноября 2026 года без вложенной Git-истории.
- Дополнения Inbound Lab находятся в `server/vpn`, `ui`, `tests/docker`, новых VPN-тестах и файлах сборки `Dockerfile.lab`, `Dockerfile.worker`, `vite.vpn.config.js`.
- В `server/index.js` добавлены маршруты VPN, инициализация сервисов и блокировка одиночного запуска в режиме VPN.
- `bun.lock` является актуальным lockfile дополненного приложения. Устаревший `package-lock.json` не включается в публичную поставку; сборки используют Bun и `Dockerfile.lab`.
