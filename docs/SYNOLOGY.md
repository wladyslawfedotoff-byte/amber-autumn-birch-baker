# Развёртывание «Пора» на Synology (Container Manager)

GitHub — источник правды. На NAS крутится контейнер с Node-сервером; снаружи только HTTPS через Reverse Proxy DSM на поддомене 4-го уровня (QuickConnect / DDNS).

## Что нужно знать про данные

- Задачи, списки, привычки и проекты хранятся **в браузере** (`localStorage`), плюс опционально синхронизация через WebDAV или папку (настройки в приложении).
- **Postgres не обязателен** для текущего приложения. Оставьте `DATABASE_URL` пустым.
- Auth и серверная БД выключены (`.grok/app-env.json`: `VITE_AUTH_ENABLED=false`). Postgres понадобится, только если позже включите вход и миграции — тогда раскомментируйте сервис `db` в `docker-compose.yml`.

## 1. Подготовка на NAS

1. Установите **Container Manager** (и при необходимости **Git Server** / пакет Git) в Package Center.
2. Создайте папку, например `/volume1/docker/pora` (или `Shared Folder` → `docker/pora`).
3. Клонируйте репозиторий (нужен доступ к **private** repo: SSH-ключ или Personal Access Token):

```bash
cd /volume1/docker
git clone git@github.com:wladyslawfedotoff-byte/amber-autumn-birch-baker.git pora
cd pora
```

Через HTTPS с токеном:

```bash
git clone https://<TOKEN>@github.com/wladyslawfedotoff-byte/amber-autumn-birch-baker.git pora
cd pora
```

4. Скопируйте пример окружения и отредактируйте:

```bash
cp .env.example .env
# nano .env   — укажите APP_URL = https://pora.<ваш-домен>.synology.me
```

Секреты (`BETTER_AUTH_SECRET`, пароли БД, `XAI_API_KEY`) не коммитьте в git.

## 2. Запуск контейнера

В Container Manager → **Project** → Create from `docker-compose.yml`, либо в SSH:

```bash
cd /volume1/docker/pora
docker compose up -d --build
```

Приложение слушает только **`127.0.0.1:8080`** на NAS (см. `ports` в compose). Снаружи порт не открывайте.

Проверка с самого NAS:

```bash
curl -sI http://127.0.0.1:8080/ | head
```

## 3. Reverse Proxy + HTTPS (Let's Encrypt)

1. **Control Panel → Login Portal → Advanced → Reverse Proxy** (или External Access → Reverse Proxy — зависит от версии DSM).
2. Создайте правило:
   - **Source:** HTTPS, hostname `pora.<ваш-домен>.synology.me`, порт `443`
   - **Destination:** HTTP, `localhost` (или `127.0.0.1`), порт `8080`
3. Включите **HSTS** и при необходимости websocket (обычно не требуется).
4. Сертификат: **Control Panel → Security → Certificate** → Let's Encrypt для этого hostname (или общий сертификат на `*.synology.me` / ваш DDNS).
5. DDNS / QuickConnect: убедитесь, что 4-й уровень резолвится на ваш NAS и порт 443 проброшен с роутера на NAS.

Итог: публично только **`https://pora.…`**, бэкенд — `http://127.0.0.1:8080` на самом NAS.

## 4. Обновление с GitHub

```bash
cd /volume1/docker/pora
git pull
docker compose up -d --build
```

Старый образ пересоберётся; именованные volumes (если включите Postgres) сохранятся.

## 5. PWA / иконка на домашнем экране

После смены URL (например, с preview на `https://pora.…`) установленное PWA может остаться со старым origin. Удалите ярлык и установите снова с нового HTTPS-адреса (в приложении есть подсказка установки / `?install=1`).

## 6. Краткая шпаргалка

| Шаг | Команда / действие |
| --- | --- |
| Клон | `git clone … pora && cd pora` |
| Env | `cp .env.example .env` → `APP_URL=https://…` |
| Старт | `docker compose up -d --build` |
| Прокси | HTTPS `pora.…` → `http://localhost:8080` |
| Обновление | `git pull && docker compose up -d --build` |

## Troubleshooting

- **Пустая страница:** проверьте, что proxy идёт на `127.0.0.1:8080`, а не на другой порт; смотрите логи Container Manager у `pora-app`.
- **Сборка падает на NAS:** нужно достаточно RAM/CPU; при нехватке соберите образ на ПК (`docker build`) и загрузите на NAS, либо увеличьте swap.
- **Auth / cookies:** если включите вход, `APP_URL` / `BETTER_AUTH_URL` должны совпадать с публичным HTTPS; задайте `BETTER_AUTH_SECRET`.
