# Развёртывание «Пора» на Synology (Container Manager)

GitHub — источник правды. На NAS работает один контейнер с Node-сервером; снаружи — только HTTPS через Reverse Proxy DSM:

```
https://pora.fedotovvladislav.synology.me:8443  →  http://127.0.0.1:8080 (контейнер pora-app)
```

## Что где хранится

- **Данные на сервере.** Задачи, списки, привычки, вехи, проекты и рабочие часы хранятся в `/data/pora.json` внутри контейнера (= `./data/pora.json` в папке проекта на NAS). Каждое устройство держит локальную копию (офлайн работает) и синхронизируется с сервером через `GET/PUT /api/sync` (ревизии, ETag/If-Match, слияние по записям — телефон и компьютер не затирают друг друга).
- **Резервные копии** сервера: `./data/backups/pora-*.json` (по умолчанию не чаще раза в 30 минут, хранится 10 последних: `BACKUP_INTERVAL_MINUTES`, `BACKUP_KEEP`). Ручная копия — в приложении: Настройки → «Резервная копия».
- **Секрет сессий:** `./data/.session-secret` (создаётся автоматически, права 0600), если не задан `SESSION_SECRET`.
- Старая синхронизация через WebDAV / «Файл» **отключена**: сохранённый пароль WebDAV стирается из браузера при первом запуске новой версии, в настройках показывается короткая заметка.
- Postgres **не нужен**. Старый вход через Grok (`better-auth`, `VITE_AUTH_ENABLED=false`) не используется.

## Образ публичный, но без секретов

`ghcr.io/wladyslawfedotoff-byte/amber-autumn-birch-baker:latest` — **публичный** пакет: `docker login` и токен для pull не нужны. В образе нет паролей и ключей; пароль задаётся только в окружении контейнера (Container Manager / `.env` на NAS). Никогда не добавляйте секреты в `Dockerfile`, `docker-compose*.yml` в git или в ARG сборки.

CI (`.github/workflows/docker-ghcr.yml`) собирает и публикует образ при каждом push в `main` (теги `:latest` и `:sha-<short>`); для pull request только собирает и прогоняет smoke-тест контейнера.

## 1. Подготовка папки

1. Package Center → установите **Container Manager**.
2. File Station → общая папка `docker` → создайте `pora`, внутри — **`data`**:
   `/volume1/docker/pora/data`
   (или по SSH: `mkdir -p /volume1/docker/pora/data`).
3. Права на `data`: контейнер сам выставляет владельца при старте (он стартует как root, готовит `/data` и затем работает от непривилегированного пользователя `node`, uid 1000). Если в журнале контейнера видно `папка данных … недоступна для записи`, сделайте одно из двух:
   - File Station → `docker/pora/data` → Свойства → Разрешения → дайте «Чтение и запись» (например, группе Everyone, с применением к вложенным);
   - или добавьте в environment `PUID`/`PGID` владельца папки (узнать: SSH → `id <ваш-пользователь-DSM>`, обычно `1026` и `100`).

Клонировать репозиторий на NAS **не обязательно** — для варианта A хватает compose-файла ниже. Если клонируете, не вставляйте токен в URL (`https://<TOKEN>@github.com/…` остаётся в `.git/config` и истории shell). Используйте SSH-ключ (`git clone git@github.com:wladyslawfedotoff-byte/amber-autumn-birch-baker.git pora`) или credential helper.

## 2. Пароль

Нужна одна переменная — **`APP_PASSWORD`** (минимум 8 символов). Пока она не задана (или осталась `СМЕНИТЕ_МЕНЯ`), приложение ничего не показывает, кроме страницы «Вход не настроен» (fail closed), а `/api/health` работает.

Вместо открытого пароля можно задать хэш **`APP_PASSWORD_HASH`** (scrypt; он имеет приоритет):

```bash
# на любом компьютере с Node 22 из клона репозитория
node scripts/hash-password.mjs
# или прямо в запущенном контейнере
docker exec -it pora-app node scripts/hash-password.mjs
```

Хэш выглядит как `scrypt:32768:8:1:<соль>:<хэш>` — в нём нет `$`, его можно вставлять в compose как есть. Если в открытом пароле есть `$`, в compose пишите его как `$$` (или используйте хэш).

Смена пароля или `SESSION_SECRET` разлогинивает все устройства. Сессия живёт 30 дней и продлевается при использовании. Ограничение: 5 неверных попыток за 15 минут с одного IP (плюс общая задержка при массовом переборе); неудачные попытки пишутся в журнал (`login.failed`).

## 3. Проект в Container Manager (вариант A, рекомендуется — готовый образ)

Container Manager → **Проект** → **Создать**:

- Название: `pora`
- Путь: `/volume1/docker/pora`
- Источник: «Создать docker-compose.yml» и вставить:

```yaml
services:
  app:
    image: ghcr.io/wladyslawfedotoff-byte/amber-autumn-birch-baker:latest
    container_name: pora-app
    restart: unless-stopped
    init: true
    environment:
      HOST: "0.0.0.0"
      PORT: "8080"
      NITRO_HOST: "0.0.0.0"
      NITRO_PORT: "8080"
      APP_URL: "https://pora.fedotovvladislav.synology.me:8443"
      VITE_GROK_EXTENSIONS: "0"
      DATA_DIR: /data
      APP_PASSWORD: "СМЕНИТЕ_МЕНЯ"
      # PUID: "1026"   # только если ./data недоступна для записи
      # PGID: "100"
    volumes:
      - ./data:/data
    ports:
      - "127.0.0.1:8080:8080"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 3
```

Замените `СМЕНИТЕ_МЕНЯ` на свой пароль → «Далее» → «Готово». Тот же файл лежит в репозитории как `docker-compose.ghcr.yml` (там значения можно брать из `.env`, см. `.env.example`).

`APP_URL` — публичный адрес **с портом** `:8443`: по нему сервер проверяет Origin у входа и изменений (защита от CSRF). Если заходите и по другому адресу, имя хоста всё равно должно совпадать с тем, что передаёт Reverse Proxy.

### Вариант B: сборка на NAS

```bash
cd /volume1/docker/pora   # клон репозитория
cp .env.example .env      # задайте APP_PASSWORD
docker compose up -d --build
```

Сборка требует RAM/CPU; вариант A проще.

## 4. Reverse Proxy + HTTPS (порт 8443)

1. Панель управления → Портал входа → Дополнительно → **Обратный прокси** → Создать:
   - **Источник:** HTTPS, имя хоста `pora.fedotovvladislav.synology.me`, порт **`8443`**, HSTS — по желанию;
   - **Назначение:** HTTP, `localhost`, порт **`8080`**.
2. Пользовательский заголовок не нужен: DSM сам передаёт `X-Forwarded-For` / `X-Forwarded-Proto` (по ним выставляется `Secure` у cookie и считается лимит попыток по IP).
3. Сертификат: Панель управления → Безопасность → Сертификат → Let's Encrypt для этого имени и привязка к правилу прокси.
4. На роутере пробросьте внешний `8443` → NAS `8443`. Порт `8080` наружу **не** открывайте (compose слушает только `127.0.0.1`).

Проверка с NAS по SSH:

```bash
curl -s http://127.0.0.1:8080/api/health
# {"ok":true,"uptime":12,"dataWritable":true}
```

## 5. Здоровье, журнал, самовосстановление

- `GET /api/health` (без входа): `200 {"ok":true,…}` или `503`, если папка данных недоступна для записи.
- Healthcheck в образе и в compose раз в 30 с опрашивает `/api/health`; Container Manager показывает статус «healthy / unhealthy».
- При фатальной ошибке процесс завершается (`exit 1`), а `restart: unless-stopped` поднимает контейнер заново.
- **Журнал:** Container Manager → Контейнер → `pora-app` → **Журнал** (или `docker logs -f pora-app`). Одна строка на событие: `server.start`, `auth.ready`, `login.failed ip=…`, `login.rate_limited`, `sync.saved`, `sync.conflict`, `sync.write_failed`, `http.5xx`, `data.not_writable`, `data.corrupt`, `process.uncaughtException`.
- **autoheal (необязательно):** Docker сам не перезапускает контейнер в состоянии «unhealthy» (только упавший). Для этого в compose есть закомментированный сервис `willfarrell/autoheal`. Ему нужен `/var/run/docker.sock` — это полный контроль над Docker на NAS, включайте осознанно: раскомментируйте сервис и `labels: autoheal: "true"` у `app`.

## 6. Обновление

Container Manager → Образ → `ghcr.io/…/amber-autumn-birch-baker` → **Обновить**, затем Проект `pora` → Остановить → Запустить. Или по SSH:

```bash
cd /volume1/docker/pora
docker compose pull
docker compose up -d
```

Данные в `./data` сохраняются между обновлениями.

## 7. Первое подключение устройств

1. Откройте `https://pora.fedotovvladislav.synology.me:8443`, введите пароль.
2. Локальные данные этого браузера **сливаются** с серверными (ничего не теряется: записи объединяются по id). Новое пустое устройство просто получает данные с сервера.
3. Повторите на телефоне. Для iOS PWA: после входа добавьте на экран «Домой» заново (старый ярлык с другим адресом удалите).
4. Статус: Настройки → «Подключение» (онлайн/офлайн/ошибка, время последней синхронизации, версия на сервере, неотправленные изменения, «Синхронизировать сейчас», «Выйти»). В шапке появляется значок, если нет связи или нужен вход.

## Troubleshooting

- **«Вход не настроен» (503):** не задан `APP_PASSWORD`/`APP_PASSWORD_HASH`, пароль короче 8 символов или остался `СМЕНИТЕ_МЕНЯ`. Причина — в журнале (`auth.not_configured reason=…`).
- **Вход сразу возвращает на /login с сообщением «Запрос пришёл не с этого сайта»:** адрес в браузере не совпадает с `APP_URL` (проверьте порт `:8443`) и с хостом, который передаёт прокси.
- **unhealthy / `dataWritable:false`:** нет прав на `/volume1/docker/pora/data` → см. п. 1.3 (права или `PUID`/`PGID`).
- **Слишком много попыток (429):** подождите 15 минут или перезапустите контейнер.
- **Восстановить данные из копии:** остановите контейнер, скопируйте нужный `data/backups/pora-….json` поверх `data/pora.json`, запустите. Устройства сольют свои локальные данные с восстановленной версией (то, что есть на устройствах, вернётся на сервер; чтобы откатить и их, перед этим выйдите на устройствах и очистите данные сайта).
