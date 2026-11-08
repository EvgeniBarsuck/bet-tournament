# Турнир на ставках

NestJS + PostgreSQL + RabbitMQ. События `bet.settled` из очереди начисляют очки (1 очко за каждый целый USD выигрыша), `bet.rollback` отменяет начисление. `GET /leaderboard` возвращает топ-100 и позицию игрока из заголовка `X-Player-Id`.

## Запуск

Нужен Docker с Compose v2.

```sh
docker compose up --build -d --wait app
docker compose exec app node dist/scripts/producer.js demo demo
curl -H "X-Player-Id: demo-alice" http://localhost:3000/leaderboard
```

Compose поднимает PostgreSQL и RabbitMQ, применяет миграции и запускает приложение на порту 3000. Ответ при пустой базе (у alice 10 USD и 25 EUR × 1.10 = 27.5 USD, то есть 10 + 27 очков):

```json
{
  "top": [
    { "playerId": "demo-bob", "points": "50", "position": 1 },
    { "playerId": "demo-alice", "points": "37", "position": 2 }
  ],
  "player": { "playerId": "demo-alice", "points": "37", "position": 2 }
}
```

Сценарии продюсера: `demo`, `duplicate` (одна ставка дважды), `rollback` (ставка и две отмены), `rollback-first` (отмена раньше ставки). Второй аргумент — префикс ID игроков и ставок; повторный запуск с тем же префиксом ничего не меняет.

Сценарий `load` генерирует случайные ставки на 20 игроков во всех валютах из `USD_RATES`: часть отправляется дважды, часть отменяется, порядок перемешан. После публикации он печатает, сколько очков должно оказаться у каждого игрока; ожидаемые значения считаются в `BigInt`, без JS `number`:

```sh
docker compose exec app node dist/scripts/producer.js load bench 100000
```

100 000 ставок (около 130 000 сообщений) один экземпляр обрабатывает примерно за минуту; подробности — в [DECISIONS.md](DECISIONS.md).

RabbitMQ Management: http://localhost:15672 (`tournament` / `tournament`).

## Очереди и DLQ

`bet.events` — quorum-очередь с `x-delivery-limit: 20`: сообщение, на котором процесс падает, после 20 неудачных доставок уходит в DLQ, а не крутится бесконечно. `bet.events.dlq` — классическая очередь для разбора вручную.

Сообщение, отклонённое консьюмером, попадает в DLQ копией с заголовками:

| Заголовок | Значение |
| --- | --- |
| `x-rejection-code` | `INVALID_EVENT`, `UNKNOWN_CURRENCY`, `OWNER_CONFLICT`, `SETTLEMENT_CONFLICT` или `UNEXPECTED_ERROR` (баг) |
| `x-rejection-reason` | текст причины, до 1000 символов |
| `x-rejected-at` | время отклонения, ISO 8601 |

Сообщения без этих заголовков отклонил сам брокер или Nest: смотрите `x-first-death-reason` (`delivery_limit` — превышен лимит доставок, `rejected` — неизвестный `pattern` или битый JSON). Чтобы переотправить сообщение после исправления причины, его достаточно переложить обратно в `bet.events` (Shovel или «Move messages» в Management): повтор идемпотентен.

Аргументы очереди (тип, лимит доставок, DLX) RabbitMQ менять на лету не даёт: при их изменении пустую очередь нужно удалить до запуска новой версии (`docker compose exec rabbitmq rabbitmqctl delete_queue bet.events`), приложение создаст её заново.

## Событие

Сообщение — стандартный Nest-envelope в очереди `bet.events`:

```json
{
  "pattern": "bet.settled",
  "data": {
    "betId": "bet-001",
    "playerId": "player-001",
    "currency": "EUR",
    "stake": "10.00",
    "winAmount": "25.00",
    "settledAt": "2026-11-06T10:00:00Z"
  }
}
```

- `pattern`: `bet.settled` или `bet.rollback`. Отмена приходит с теми же полями, но списывает сохранённое начисление, а не `winAmount` из события.
- `betId`, `playerId`: 1–128 символов `[A-Za-z0-9_.:-]`.
- `currency`: три заглавные буквы; курс должен быть в `USD_RATES`.
- `stake`, `winAmount`: неотрицательные десятичные **строки**, до 12 цифр до точки и 8 после. JSON-числа отклоняются, чтобы не терять точность.
- `settledAt`: ISO 8601 с часовым поясом; год `0000` отклоняется (его нет в PostgreSQL).

## API

`GET /leaderboard` с заголовком `X-Player-Id` → `{ top, player }`. Очки — целое число в виде строки. Порядок: очки по убыванию, при равенстве `playerId` по возрастанию. Игроки с нулём очков в рейтинг не входят: у них `points: "0"`, `position: null`. Без заголовка или с невалидным — 400.

`GET /health/live` — 200, пока процесс отвечает; зависимости не проверяются, чтобы авария БД или брокера не приводила к перезапуску.

`GET /health/ready` — 200, если БД доступна и в ней применена последняя миграция этой сборки, а консьюмер подключён к RabbitMQ; иначе 503 с `{ status, database, broker }`. Её использует healthcheck в Compose.

## Конфигурация

| Переменная | По умолчанию |
| --- | --- |
| `DATABASE_URL` | обязательна |
| `RABBITMQ_URL` | обязательна |
| `RABBITMQ_QUEUE` | `bet.events` (DLQ — `<queue>.dlq`) |
| `PORT` | `3000` |
| `PREFETCH` | `10` — сколько сообщений обрабатывается параллельно |
| `DB_POOL_SIZE` | `PREFETCH + 2`; не меньше этого и не больше 50 |
| `USD_RATES` | `{"USD":"1"}`; в Compose добавлены `EUR: 1.10`, `GBP: 1.25` |
| `LOG_FORMAT` | `json` (строка JSON на запись); `text` — цветной вывод для разработки |

Курс — USD за единицу валюты, десятичная строка.

## Разработка и тесты

Нужен Node.js 24+. Скопируйте `.env.example` в `.env`.

```sh
npm ci
npm run check                                # prettier, eslint, сборка, unit-тесты
docker compose up -d --wait postgres rabbitmq
npm run test:integration                     # настоящая PostgreSQL, база tournament_test
npm run migrate && npm start                 # приложение локально
npm run test:smoke                           # producer → RabbitMQ → consumer → БД → HTTP, DLQ, load
```

Тесты запускаются из `dist`, поэтому после правок нужна сборка (`npm run check` или `npm run build`). Integration создаёт временную схему в базе `*_test` и удаляет её после прогона. Те же шаги выполняет CI: [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Устройство

```
src/
  bets/          bet-event.ts (схема), bets.service.ts (правила), bets.repository.ts (SQL),
                 bets.consumer.ts (RabbitMQ)
  leaderboard/   leaderboard.repository.ts (SQL), leaderboard.service.ts, leaderboard.controller.ts (HTTP)
  config/        разбор переменных окружения, ConfigModule
  db/            пул, транзакция, retry временных ошибок, миграции
  messaging/     топология очередей, публикация копий в DLQ и в очередь, статус брокера
  common/        форматы ID, валюты и сумм, декоратор X-Player-Id
migrations/      SQL-схема
scripts/         продюсер, миграции, smoke
```

Обработка сообщения — одна транзакция: вставка или блокировка строки `bets` и изменение `player_scores`. ACK отправляется только после commit. Повторная доставка безопасна: уникальный `bet_id` не даёт начислить дважды. Ошибки данных (невалидное событие, конфликт, неизвестная валюта) отправляются в DLQ без повторов, с кодом причины в заголовке. Временные ошибки БД (deadlock, lock timeout, обрыв соединения, недоступный хост) повторяются около минуты с нарастающей паузой, затем копия сообщения публикуется в конец очереди, а не в DLQ: при аварии БД обработка встаёт на паузу, и после восстановления сообщения обрабатываются. При остановке приложение отменяет подписку на очередь, прерывает повторы и до 10 секунд ждёт, пока каждое полученное сообщение будет подтверждено или возвращено в очередь копией.

Принятые допущения и их причины — в [DECISIONS.md](DECISIONS.md).
