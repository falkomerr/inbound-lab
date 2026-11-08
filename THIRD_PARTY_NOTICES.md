# Сторонние компоненты

В приложении используется код FasterTest по лицензии ISC. Обязательные уведомления, copyright и ссылка на точный коммит сохранены в `platform/LICENSE`, `platform/licenses/fastertest/ISC.txt`, `platform/UPSTREAM.md`.

Лицензия собственного исходного кода не заменяет лицензии контейнеров и зависимостей. Полные исходные notices FasterTest/k6 находятся в [platform/THIRD_PARTY_NOTICES.md](platform/THIRD_PARTY_NOTICES.md).

| Компонент | Использование | Лицензия / источник |
| --- | --- | --- |
| FasterTest | Код приложения | ISC, сохранённый copyright |
| k6 1.8.0 | Отдельный worker-образ | AGPL-3.0, [исходный код](https://github.com/grafana/k6/tree/v1.8.0), полный текст в `platform/licenses/k6/AGPL-3.0.txt` |
| Xray-core | Отдельный VPN-контейнер | MPL-2.0, [upstream](https://github.com/XTLS/Xray-core) |
| MySQL Community | Отдельная БД | GPL-2.0 и уведомления поставки, [upstream](https://github.com/mysql/mysql-server) |
| Redis | Отдельная очередь | Лицензия конкретного образа/версии, [upstream](https://github.com/redis/redis) |
| Prometheus / node_exporter | Отдельные контейнеры метрик | Apache-2.0, [upstream](https://github.com/prometheus) |
| Grafana OSS | Отдельный интерфейс метрик | AGPL-3.0, [upstream](https://github.com/grafana/grafana) |
| Node.js, Bun, Alpine/Debian и Node-пакеты | Среда сборки/выполнения | Собственные лицензии и notices соответствующих поставок |

Основной API-образ `Dockerfile.lab` не включает k6; `Dockerfile.worker` расширяет официальный k6-образ. Старый FasterTest `Dockerfile` сохраняется как upstream-вариант и имеет отдельные notices. При распространении бинарных образов сохраняйте необходимые уведомления и обеспечивайте доступность соответствующего исходного кода по применимым лицензиям; публикация исходников приложения сама по себе не заменяет эти обязанности. Этот файл не объявляет весь Compose-стек ISC-лицензированным.

Проект независим от Grafana Labs, k6, XTLS и авторов FasterTest; названия принадлежат соответствующим правообладателям.
