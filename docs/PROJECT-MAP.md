# Карта проекта «Пора»

> **Обновляется в каждом PR.** Добавили, переименовали или удалили модуль — поправьте эту карту, [`ARCHITECTURE.md`](ARCHITECTURE.md) и [`CHANGELOG.md`](CHANGELOG.md) в том же PR.

С этой карты удобно начинать любую задачу: найдите область в таблице «Если задача про…», откройте 2–5 указанных файлов и прогоните только их тесты. Весь репозиторий читать не нужно. Подробнее о том, как всё устроено, — в [`ARCHITECTURE.md`](ARCHITECTURE.md); почему так решили — в [`DECISIONS.md`](DECISIONS.md).

## Команды

Нужен **Node 22** (`engines: >=22`, так же в CI и в образе `node:22-bookworm-slim`). Если в системе стоит другая версия, добавьте Node 22 в `PATH` перед командами, например `export PATH=<папка node22>/bin:$PATH`.

| Что | Команда |
| --- | --- |
| Установка | `npm ci` |
| Разработка (порт 8080, только клиент) | `npm run dev` |
| Полный стек с сервером | `npm run build && npm run preview` |
| Проверка типов | `npm run typecheck` (`tsc --noEmit`) |
| Все тесты | `npm test` |
| Один тест-файл (TS) | `node --experimental-strip-types --test src/lib/day-board.test.ts` |
| Несколько файлов | `node --experimental-strip-types --test server/lib/helper/*.test.ts` |
| Тесты скриптов | `node --test 'scripts/**/*.test.mjs'` |
| Линт + цвета + контраст | `npm run lint` (ESLint, `scripts/check-raw-colors.mjs`, `scripts/contrast.mjs`) |
| Запрет чужих названий | `node scripts/brand-check.mjs` |
| Сборка | `npm run build` → `.output/` (сервер: `node .output/server/index.mjs`) |
| Перед PR (как в CI) | `npm run typecheck && npm test && npm run lint && node scripts/brand-check.mjs` |

Тестового фреймворка вроде vitest нет: тесты — это встроенный `node --test`, TypeScript запускается через `--experimental-strip-types`. **Новый тест-файл нужно дописать в список `scripts.test` в `package.json`**, иначе `npm test` и CI его не запустят. Скрипты `scripts/e2e-*.mjs` — ручные сквозные проверки в браузере (Playwright) против запущенной сборки, в CI не входят.

## Точки входа

- **Клиент:** `src/router.tsx` → `src/routes/__root.tsx` (HTML-оболочка, мета, ранняя загрузка данных) → `src/routes/index.tsx` → `PlannerApp` (`src/components/planner/app.tsx`). Скрытая страница `src/routes/kit.tsx` (`/kit`) показывает дизайн-токены и компоненты. `src/routeTree.gen.ts` генерируется, руками не правится.
- **Сервер:** Nitro (подключается в `vite.config.ts` только при сборке и `preview`, `serverDir: ./server`). Порядок обработки запроса:
  1. статика Nitro (`/assets/*`, иконки, `manifest`, `sw.js`) — до middleware;
  2. `server/middleware/00.guard.ts` — заголовки безопасности, сжатие, лог и чистый ответ при 5xx;
  3. `server/middleware/01.auth.ts` — вход по сессии, проверка «тот же сайт», пропуск без сессии только для `/api/health`, страницы входа, `POST /api/quick-add` с ключом устройства и `/api/helper/*` с ключом помощника;
  4. маршрут из `server/routes/` (файловый роутинг: `name.get.ts` — метод, `[...].ts` — всё под папкой).
- **Фоновые задачи:** `server/plugins/*` стартуют вместе с сервером.
- **Сборка образа:** `Dockerfile` → `CMD node .output/server/index.mjs`, проверка здоровья — `/api/health`.

## Структура

```
src/
  routes/            страницы TanStack Router (/, /kit)
  components/
    planner/         экраны и части приложения
    ui/              общий набор компонентов (kit, sheet, button, hint, rows)
  lib/               логика без React там, где можно (её покрывают тесты)
    sync/            модель документа, слияние, один прогон синхронизации
    offline/         локальная копия, очередь отправки, service worker, push
    planner/         состояние стора: типы, начальные данные, отметки
    assistant/       клиент помощника: карточки, «Применить», история
    attachments/     очередь загрузки файлов, сжатие фото, EXIF
    maintenance/     «Обслуживание»: правила, статистика, топливо, гарантия
    objects/         ссылки и контакты задачи
    design/          токены (TS-сторона)
    og/              название и слоган (site.json)
  tokens.css         дизайн-токены (CSS-переменные)
  styles.css         глобальные стили
server/
  middleware/        00.guard, 01.auth
  routes/            /login и /api/*
  plugins/           фоновые задачи
  lib/               серверная логика
    db/              SQLite: схема, миграции, импорт/экспорт, снимки
    ai/              помощник: модели, инструменты, контекст, беседы
    push/            Web Push: VAPID, расписание, подписки
    attachments/     файлы: тип по содержимому, HEIC → JPEG, доступ, очистка
    quick-add/       быстрое добавление: ключи, разбор тела, лимиты
    helper/          ключи помощника: ключи и журнал, задачи и списки, лимиты
  types/             объявления типов для библиотек без них
scripts/             обслуживание на NAS, проверки CI, сборка иконок, e2e
docs/                эта карта и остальные документы
public/              иконки, manifest, экраны запуска
docker/              entrypoint.sh
.github/workflows/   docker-ghcr.yml (проверки + образ), sync-package-lock.yml (ручной)
```

## Модули

### `src/components/planner/`

| Файл | За что отвечает |
| --- | --- |
| `app.tsx` | Корень приложения: выбор раздела, заголовок и подзаголовок экрана, шторки, тосты |
| `sidebar.tsx` | Боковое меню: умные списки, разделы, «Мои списки», проекты, теги, закрепление |
| `task-views.tsx`, `task-row.tsx`, `row-window.tsx` | Списки задач и строка задачи (свайпы, бейджи, подгрузка при прокрутке) |
| `task-menu.tsx` | Меню долгого нажатия на задачу |
| `detail.tsx`, `task-extras.tsx` | Карточка задачи (дата, время, «Вмещает дела», повтор, список, проект, этап…) |
| `quick-composer.tsx` | Быстрый ввод задачи (кнопка «+», разбор текста) |
| `today-strip.tsx`, `checklist-view.tsx` | «Сегодня», «Все» |
| `schedule-screen.tsx`, `schedule-view.tsx` | «Расписание» по часам на 1–7 дней |
| `calendar-view.tsx` | Календарь |
| `projects-view.tsx` | Проекты: горизонтальная доска этапов, карточки — задачи |
| `matrix-view.tsx`, `focus-view.tsx`, `dates-view.tsx` | Матрица, фокус-таймер, памятные даты |
| `habits-view.tsx`, `habits/*` | Привычки |
| `maintenance/*` | «Обслуживание»: карточки авто и техники, заправки, статистика |
| `objects/*` | Вложения, контакты, «Ждёт» в карточке задачи |
| `assist-*.tsx` | Экран помощника, его карточки, уведомления, настройки |
| `settings-view.tsx` | Настройки |
| `quick-add-settings.tsx` | Ключи устройств «Быстрое добавление» |
| `helper-settings.tsx`, `helper-tag.tsx` | «Помощники» (ключи ботов, журнал); метка «от помощника» и отчёт |
| `sharing.tsx` | Совместные и назначенные задачи |
| `sync-status.tsx`, `reminder-ui.tsx`, `done-toast.tsx`, `skeleton.tsx`, `empty-state.tsx` | Статус синхронизации, напоминания, тосты, каркас загрузки |

### `src/components/ui/`

`kit.tsx` — набор (значок-квадрат, строка списка, сгруппированная карточка, пилюля, поле, переключатель, сегменты, баннер, пустой экран); `sheet.tsx` — шторка снизу на телефоне / диалог на широком экране; `button.tsx`, `hint.tsx` («?» с пояснением), `rows.tsx`.

### `src/lib/`

| Файл | За что отвечает |
| --- | --- |
| `planner-types.ts` | Типы данных: задача, список, проект, привычка, карточка обслуживания |
| `planner-store.ts` | Стор zustand с `persist`: все действия над данными (самый связанный модуль после типов) |
| `planner/state.ts`, `planner/defaults.ts`, `planner/stamp.ts` | Типы состояния, начальные значения, отметки синхронизации для локальных правок |
| `queries.ts` | Выборки и счётчики («Сегодня», «Входящие», список, тег, общие) |
| `dates.ts` | Даты, повторы, подписи |
| `day-board.ts` | Раскладка расписания: интервалы, накладки, «Вмещает дела», свободные окна |
| `calendar-layout.ts` | Сетка календаря |
| `projects.ts`, `stage-range.ts` | Проекты: этапы, порядок карточек, прогресс, сроки этапов |
| `task-done.ts`, `task-undo.ts`, `task-tools.ts`, `task-deps.ts`, `task-colors.ts` | Выполнение и архив, отмена удаления, дублирование, «Ждёт», цвета |
| `quick-add.ts`, `paste-lines.ts` | Разбор быстрого ввода («завтра в 9 …», `#теги`), вставка нескольких строк |
| `reminders.ts` | Напоминания в приложении |
| `server-sync.ts`, `use-server-sync.ts` | Синхронизация браузера с сервером (обвязка над `sync/engine.ts`) |
| `use-capabilities.ts` | Профиль и включённые функции сервера (`/api/me`) |
| `habit-*.ts`, `special-dates.ts` | Привычки, памятные даты |
| `backup.ts` | Ручной экспорт/импорт резервной копии |
| `ui-prefs.ts`, `text-size.ts`, `viewport.ts`, `popover.ts`, `sheet-drag.ts`, `haptics.ts` | Настройки устройства, размер текста iOS, клавиатура iOS, меню, жесты |
| `site.ts`, `og/site.json`, `app-icons.ts`, `accents.ts` | Название, иконки, акцентные цвета |

### `src/lib/sync/`

| Файл | За что отвечает |
| --- | --- |
| `merge.ts` | Модель документа (коллекции `lists`, `tasks`, `habits`, `milestones`, `projects`, `assets`), отметки по полям (`_b`, `_f`, `_s`, `_d`), слияние, `normalizeData`, `editEntity` для правок на сервере |
| `engine.ts` | Один прогон синхронизации: условный GET (ETag → 304), `PATCH` только изменённого |
| `world.ts` | Несколько профилей: общий документ и представление для каждого пользователя (ACL) |
| `clock.ts` | Часы устройства, поправленные по часам сервера |
| `prefetch.ts` | Ранний запрос первой копии данных из `<head>` |

### `src/lib/offline/`

`local-db.ts` (IndexedDB «pora-local», отдельно для каждого пользователя), `device-store.ts`, `outbox.ts` (очередь «ждут отправки»), `sw-client.ts` + `stale-chunks.ts` (service worker и обновления), `push-client.ts` (подписка на Web Push), `assist-queue.ts` (вопросы помощнику без сети), `use-online.ts`.

### `server/lib/`

| Файл / папка | За что отвечает |
| --- | --- |
| `auth.ts` | Конфигурация входа из окружения (`APP_PASSWORD[_HASH]`, `APP_USERS`, `USER_*`); без пароля — «закрыто» |
| `session.ts`, `session-cookie.ts`, `session-epoch.ts` | Подписанная сессия, cookie, «эпоха» для «Выйти на всех устройствах» |
| `principal.ts` | Кто вошёл (из проверенной сессии), список профилей |
| `user-store.ts` | Пароль, сменённый в приложении, и эпоха пользователя |
| `rate-limit.ts` | Ограничение неудачных входов |
| `sync-store.ts`, `sync-access.ts` | Хранилище документа синхронизации (ревизии, `get/put`, `getFor/putFor` по ACL), резервные копии |
| `db/*` | SQLite `pora.db`: открытие и миграции (`database.ts`, `schema.ts`), документ ↔ таблицы (`doc-tables.ts`), малые таблицы (`records.ts`), выбор SQLite/JSON (`storage.ts`), импорт из JSON 1.11, экспорт, ночные снимки |
| `http.ts`, `log.ts`, `pages.ts`, `security.ts`, `compress.ts` | Ответы и тело запроса, однострочный лог, серверные страницы (вход, ошибки), заголовки, сжатие |
| `link-title.ts` | Заголовок страницы по ссылке (без доступа в домашнюю сеть) |
| `ai/*` | Помощник: цепочка моделей (`provider.ts`, `config.ts`), один ответ с инструментами (`agent.ts`, `tools.ts`), контекст (`context.ts`), беседы, JSON-режим |
| `push/*` | Web Push без сторонних библиотек, расписание напоминаний, подписки |
| `attachments/*` | Файлы: хранение, тип по байтам, HEIC → JPEG, доступ по ACL, очистка |
| `quick-add/*` | Ключи устройств (`tokens.ts`), разбор формы (`parse.ts`), запись во «Входящие» (`add.ts`), лимиты |
| `helper/*` | Ключи помощника и журнал (`keys.ts`), свои задачи и списки ключа (`tasks.ts`), лимиты (`limit.ts`) |

### `server/routes/`

| Маршрут | Что делает |
| --- | --- |
| `login.get.ts`, `api/login.post.ts`, `api/logout.post.ts`, `api/logout-all.post.ts`, `api/password.post.ts` | Вход, выход, «выйти везде», смена пароля |
| `api/me.get.ts`, `api/capabilities.get.ts` | Профиль и включённые функции |
| `api/sync.get.ts`, `api/sync.put.ts`, `api/sync.patch.ts` | Синхронизация (чтение с ETag, полная запись, запись изменений) |
| `api/assistant/[...].ts` | Помощник |
| `api/attachments/[...].ts` | Вложения |
| `api/push/[...].ts` | Подписки на напоминания |
| `api/quick-add.post.ts`, `api/quick-tokens/[...].ts` | Быстрое добавление и его ключи |
| `api/helper/[...].ts`, `api/helper-keys/[...].ts` | API для ботов (см. [`HELPER-API.md`](HELPER-API.md)) и управление ключами в настройках |
| `api/link-title.get.ts`, `api/health.ts`, `api/[...].ts` | Заголовок ссылки, проверка здоровья, JSON 404 для неизвестных `/api/*` |

### `server/plugins/`

`db-snapshots.ts` (раз в сутки снимок `pora.db` в `backup/`, хранятся 7), `push-scheduler.ts` (напоминания раз в 30 с), `assistant-queue.ts` (раз в минуту — отложенные вопросы помощнику), `attachments-cleanup.ts` (раз в 6 часов файлы удалённых задач), `process-guard.ts` (при необработанной ошибке процесс завершается и перезапускается).

### `scripts/`

- **На NAS** (`docker exec pora-app node scripts/…`): `restore-backup.mjs`, `reset-password.mjs`, `db-snapshot.mjs`, `export-json.mjs`, `db-downgrade-1.12.mjs`, `db-downgrade-1.24.mjs`, `hash-password.mjs`, `push-keys.mjs`.
- **Проверки:** `brand-check.mjs`, `check-raw-colors.mjs`, `contrast.mjs`.
- **Сборка:** `sw-plugin.mjs` + `sw-template.js` (service worker), `make-icons.mjs`, `make-splash.mjs`.
- **Ручные e2e:** `e2e-*.mjs`.

### Тесты

Лежат рядом с кодом: `src/lib/**/*.test.ts`, `server/lib/**/*.test.ts`, `scripts/*.test.mjs`. Маршруты тестируются вызовом обработчика с собственным `DATA_DIR` во временной папке (примеры: `server/lib/sync-patch.route.test.ts`, `server/lib/helper/helper.test.ts`). Компоненты React юнит-тестами не покрыты — их проверяют скриншоты и e2e.

## Если задача про X — смотри файлы Y, тесты Z

| Область | Файлы | Тесты |
| --- | --- | --- |
| Расписание | `src/lib/day-board.ts`, `src/components/planner/schedule-screen.tsx`, `schedule-view.tsx`, `calendar-layout.ts` | `src/lib/day-board.test.ts`, `src/lib/dates.test.ts` |
| Проекты | `src/lib/projects.ts`, `src/lib/stage-range.ts`, `src/components/planner/projects-view.tsx`, `detail.tsx` (строки «Проект», «Этап»), `planner-store.ts` | `src/lib/projects.test.ts` |
| Списки и меню | `src/components/planner/sidebar.tsx`, `task-views.tsx`, `src/lib/queries.ts`, `src/lib/ui-prefs.ts`, `planner-store.ts` (`addList`, `deleteList`) | `src/lib/ui-prefs.test.ts`, `src/lib/reorder.test.ts` |
| Синхронизация | `src/lib/sync/*`, `src/lib/server-sync.ts`, `src/lib/offline/outbox.ts`, `local-db.ts`, `server/routes/api/sync.*.ts`, `server/lib/sync-store.ts`, `server/lib/db/doc-tables.ts` | `src/lib/sync/*.test.ts`, `src/lib/offline/*.test.ts`, `server/lib/sync-store.test.ts`, `server/lib/sync-patch.route.test.ts`, `server/lib/db/db.test.ts` |
| Авторизация | `server/middleware/01.auth.ts`, `server/lib/auth.ts`, `session*.ts`, `principal.ts`, `user-store.ts`, `rate-limit.ts`, `server/routes/api/login.post.ts`, `password.post.ts` | `server/lib/auth.test.ts`, `server/lib/http.test.ts`, `server/lib/pages.test.ts`, `scripts/password-hash.test.mjs`, `scripts/reset-password.test.mjs` |
| Помощник (AI) | `server/lib/ai/*`, `server/routes/api/assistant/[...].ts`, `server/plugins/assistant-queue.ts`, `src/lib/assistant/*`, `src/components/planner/assist-*.tsx` | `server/lib/ai/*.test.ts`, `src/lib/assistant/*.test.ts` |
| Ключи помощника | `server/lib/helper/*`, `server/routes/api/helper/[...].ts`, `helper-keys/[...].ts`, `01.auth.ts`, `src/components/planner/helper-settings.tsx`, `helper-tag.tsx`, [`HELPER-API.md`](HELPER-API.md) | `server/lib/helper/*.test.ts` |
| Быстрое добавление | `server/lib/quick-add/*`, `server/routes/api/quick-add.post.ts`, `quick-tokens/[...].ts`, `src/components/planner/quick-add-settings.tsx`; ввод в приложении — `src/lib/quick-add.ts`, `quick-composer.tsx` | `server/lib/quick-add/*.test.ts`, `src/lib/quick-add.test.ts` |
| Push-напоминания | `server/lib/push/*`, `server/routes/api/push/[...].ts`, `server/plugins/push-scheduler.ts`, `src/lib/offline/push-client.ts`, `scripts/sw-template.js` | `server/lib/push/push.test.ts`, `scripts/sw-plugin.test.mjs` |
| Дизайн-система | `src/tokens.css`, `src/lib/design/tokens.ts`, `src/components/ui/*`, `src/routes/kit.tsx` | `npm run lint` (`check-raw-colors`, `contrast`) |
| Вложения | `server/lib/attachments/*`, `server/routes/api/attachments/[...].ts`, `server/plugins/attachments-cleanup.ts`, `src/lib/attachments/*`, `src/components/planner/objects/*` | `server/lib/attachments/*.test.ts`, `src/lib/attachments/*.test.ts` |
| База и миграции | `server/lib/db/schema.ts`, `database.ts`, `storage.ts`, `scripts/db-downgrade-*.mjs` | `server/lib/db/db.test.ts`, `server/lib/db/scripts.test.ts` |
