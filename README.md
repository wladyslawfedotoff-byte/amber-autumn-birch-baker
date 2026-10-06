# Пора

**«Пора»** — личный планировщик в духе TickTick: задачи, календарь, привычки и фокус-таймер в одном приложении. Работает в браузере и как PWA на телефоне, хранит данные локально (офлайн) и синхронизирует их через собственный сервер — например, Docker-контейнер на Synology NAS. Вход по одному паролю, сторонних аккаунтов нет.

## Возможности

- **Задачи:** «Входящие», «Сегодня», «Завтра», «7 дней», «Все»; списки, подзадачи, приоритеты, повторы, напоминания.
- **Быстрый ввод по-русски:** «завтра в 9 позвонить врачу» — дата и время распознаются из текста.
- **Календарь и расписание:** раскладка задач по дням и часам, перетаскивание, рабочие часы.
- **Проекты** (канбан), **матрица Эйзенхауэра**, **даты** (вехи и обратный отсчёт).
- **Привычки** и **фокус-таймер** (помодоро).
- **Помощник** (необязательно, нужен ключ xAI API): разбор текста на задачи и план на день.
- **Синхронизация** между устройствами через свой сервер: ревизии, слияние по записям, офлайн-очередь; резервные копии на сервере и ручной экспорт/импорт в настройках.

## Технологии

React 19, TanStack Start / Router, Vite 8, Nitro 3 (preset `node-server` для Docker), Tailwind CSS 4, Zustand. Данные синхронизации — JSON-файл на сервере (`DATA_DIR/pora.json`), база данных не нужна.

## Локальная разработка

Нужен **Node.js 22** (см. `engines` в `package.json`).

```bash
npm ci
# сервер разработки на http://localhost:8080
APP_PASSWORD='локальный-пароль-123' DATA_DIR=./data npm run dev
# или без входа (только локально, в production игнорируется):
AUTH_DISABLED=true DATA_DIR=./data npm run dev
```

Проверки и сборка:

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # модульные тесты (node --test)

# production-сборка для своего сервера / Docker
NITRO_PRESET=node-server VITE_GROK_EXTENSIONS=0 npm run build
APP_PASSWORD='<своя фраза, 16+ символов>' DATA_DIR=./data PORT=8080 node .output/server/index.mjs
```

Папка `./data` (данные, ключ сессий, резервные копии) и любые `.env` в git не попадают.

## Развёртывание (Docker / Synology)

Образ собирается GitHub Actions и публикуется в GHCR: `ghcr.io/wladyslawfedotoff-byte/amber-autumn-birch-baker:latest` (образ публичный, секретов в нём нет).

- [`docker-compose.ghcr.yml`](docker-compose.ghcr.yml) — готовый образ (рекомендуется для NAS);
- [`docker-compose.yml`](docker-compose.yml) — сборка образа из исходников;
- пошаговая инструкция для Synology Container Manager, Reverse Proxy DSM и HTTPS — [`docs/SYNOLOGY.md`](docs/SYNOLOGY.md).

Структура на сервере:

```
pora/
├── compose.yaml   # без секретов
├── .env           # секреты (см. .env.example), права только для администратора
└── data/          # pora.json, backups/, .session-secret, .session-epoch
```

Проверка: `curl http://127.0.0.1:8080/api/health` → `{"ok":true,…}`.

## Переменные окружения

Все секреты задаются в файле `.env` рядом с compose-файлом (`env_file`); подробный шаблон с пояснениями и правилами записи `$` — [`.env.example`](.env.example).

| Переменная | Где | Назначение |
| --- | --- | --- |
| `APP_PASSWORD` | `.env` | Пароль входа: рекомендуется фраза 16+ символов, минимум 12 (12–15 — предупреждение в журнале). Без него или хэша приложение закрыто (fail closed). |
| `APP_PASSWORD_HASH` | `.env` | scrypt-хэш пароля (`node scripts/hash-password.mjs`), имеет приоритет. Рекомендуется. |
| `SESSION_SECRET` | `.env`, необяз. | Ключ подписи сессий (≥ 32 символов). Иначе создаётся `DATA_DIR/.session-secret`. |
| `XAI_API_KEY` | `.env`, необяз. | Ключ для «Помощника» (без ключа пункт скрыт). |
| `PUID` / `PGID` | `.env`, необяз. | Владелец папки данных, если она недоступна для записи. |
| `BACKUP_INTERVAL_MINUTES` | `.env`, необяз. | Не чаще одной резервной копии за N минут (30). |
| `BACKUP_HOURLY` / `BACKUP_DAILY` | `.env`, необяз. | Хранить по одной копии на каждый из последних N часов / M дней (24 / 30). |
| `APP_URL` | compose | Публичный адрес с портом — для проверки Origin (CSRF). |
| `DATA_DIR` | compose | Папка данных в контейнере (`/data`). |
| `VITE_GROK_EXTENSIONS` | compose / сборка | `0` — без стороннего скрипта расширений Grok. |
| `AUTH_DISABLED` | только разработка | `true` отключает вход вне production. |

## Безопасность

- Один пароль на всё приложение; хранится как scrypt-хэш (`APP_PASSWORD_HASH`) или сравнивается по SHA-256 в постоянное время.
- Без настроенного пароля сервер отдаёт только `/api/health` и страницу «Вход не настроен».
- Сессия — подписанная cookie `__Host-pora_session` (`HttpOnly`, `SameSite=Lax`, `Secure` за HTTPS); 30 дней без использования, не дольше 90 дней после ввода пароля. «Выйти на всех устройствах» в настройках, смена пароля или ключа разлогинивают все устройства.
- Проверка Origin для входа и изменений (точное совпадение с `APP_URL`, включая порт), безопасный редирект после входа, HSTS на HTTPS, ограничение попыток входа (5 за 15 минут с IP и общий порог 50 неудач для новых входов), журнал неудачных входов с IP.
- Контейнер работает от непривилегированного пользователя (`no-new-privileges`, `cap_drop: ALL` + минимальный `cap_add`), драйвер журнала не переопределяется (на Synology журнал хранит Container Manager), порт опубликован только на `127.0.0.1`, наружу — HTTPS через Reverse Proxy.
- Резервные копии: встроенные (по часам и дням) с восстановлением `docker exec pora-app node scripts/restore-backup.mjs`, плюс Hyper Backup — см. [`docs/SYNOLOGY.md`](docs/SYNOLOGY.md#8-резервные-копии-и-восстановление).
- Секреты никогда не попадают в git, Docker-образ или compose-файл: только `.env` на сервере (`.gitignore`, `.dockerignore`).
- Не вставляйте токены GitHub в URL клонирования; используйте SSH-ключ.

## Структура проекта

```
src/
  routes/              страницы TanStack Router (__root.tsx — заголовок, мета, PWA)
  components/planner/  интерфейс планировщика (виды, боковая панель, настройки)
  lib/                 состояние (planner-store), синхронизация (sync/, server-sync),
                       быстрый ввод, напоминания, резервные копии
  lib/og/site.json     название и описание приложения для мета-тегов и PWA
server/
  routes/              /api/health, /api/login, /api/logout, /api/logout-all, /api/sync,
                       /api/capabilities, /login
  middleware/          защита процесса, проверка входа, PWA-манифест
  lib/                 хранилище синхронизации, сессии, лимиты, журнал
scripts/               сборочные плагины, hash-password.mjs, restore-backup.mjs, e2e-sync.mjs,
                       тесты (*.test.mjs)
docker/entrypoint.sh   подготовка /data и запуск от непривилегированного пользователя
docs/SYNOLOGY.md       развёртывание на Synology
.github/workflows/     сборка и публикация образа, smoke-тест контейнера
```

Каталоги `.grok/`, `AGENTS.md`, `startup.sh`, `vercel.json` относятся к среде Grok App Builder, в которой проект был создан; для сборки и работы на своём сервере они не нужны.
