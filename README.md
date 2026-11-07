# Турнир на ставках

NestJS + PostgreSQL + RabbitMQ. События `bet.settled` из очереди начисляют очки (1 очко за 1 USD выигрыша), `bet.rollback` отменяет начисление. `GET /leaderboard` возвращает топ-100 и позицию игрока из заголовка `X-Player-Id`.

## Запуск

Нужен Docker с Compose v2.

```sh
docker compose up --build -d --wait app
docker compose exec app node dist/scripts/producer.js demo demo
curl -H "X-Player-Id: demo-alice" http://localhost:3000/leaderboard
```

Compose поднимает PostgreSQL и RabbitMQ, применяет миграции и запускает приложение на порту 3000. Ответ при пустой базе:

```json
{
  "top": [
    { "playerId": "demo-bob", "points": "50", "position": 1 },
    { "playerId": "demo-alice", "points": "37.5", "position": 2 }
  ],
  "player": { "playerId": "demo-alice", "points": "37.5", "position": 2 }
}
```

Сценарии продюсера: `demo`, `duplicate` (одна ставка дважды), `rollback` (ставка и две отмены), `rollback-first` (отмена раньше ставки). Второй аргумент — префикс ID игроков и ставок; повторный запуск с тем же префиксом ничего не меняет.

RabbitMQ Management: http://localhost:15672 (`tournament` / `tournament`). Отклонённые сообщения лежат в очереди `bet.events.dlq`.

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
- `settledAt`: ISO 8601 с часовым поясом.

## API

`GET /leaderboard` с заголовком `X-Player-Id` → `{ top, player }`. Очки — десятичная строка. Порядок: очки по убыванию, при равенстве `playerId` по возрастанию. Игроки с нулём очков в рейтинг не входят: у них `points: "0"`, `position: null`. Без заголовка или с невалидным — 400.

`GET /health` — 200, если доступна БД со схемой.

## Конфигурация

| Переменная | По умолчанию |
| --- | --- |
| `DATABASE_URL` | обязательна |
| `RABBITMQ_URL` | обязательна |
| `RABBITMQ_QUEUE` | `bet.events` (DLQ — `<queue>.dlq`) |
| `PORT` | `3000` |
| `PREFETCH` | `10` — сколько сообщений обрабатывается параллельно |
| `USD_RATES` | `{"USD":"1"}`; в Compose добавлены `EUR: 1.10`, `GBP: 1.25` |

Курс — USD за единицу валюты, десятичная строка.

## Разработка и тесты

Нужен Node.js 24+. Скопируйте `.env.example` в `.env`.

```sh
npm ci
npm run check                                # prettier, eslint, сборка, unit-тесты
docker compose up -d --wait postgres rabbitmq
npm run test:integration                     # настоящая PostgreSQL, база tournament_test
npm run migrate && npm start                 # приложение локально
npm run test:smoke                           # producer → RabbitMQ → consumer → БД → HTTP
```

Тесты запускаются из `dist`, поэтому после правок нужна сборка (`npm run check` или `npm run build`). Integration создаёт временную схему в базе `*_test` и удаляет её после прогона.

## Устройство

```
src/
  bets/          bet-event.ts (схема), bets.service.ts (правила), bets.repository.ts (SQL),
                 bets.consumer.ts (RabbitMQ)
  leaderboard/   leaderboard.service.ts (SQL), leaderboard.controller.ts (HTTP)
  db/            пул, транзакция, retry временных ошибок, миграции
  messaging/     DLX/DLQ-топология
migrations/      SQL-схема
scripts/         продюсер, миграции, smoke
```

Обработка сообщения — одна транзакция: вставка или блокировка строки `bets` и изменение `player_scores`. ACK отправляется только после commit. Повторная доставка безопасна: уникальный `bet_id` не даёт начислить дважды. Ошибки данных (невалидное событие, конфликт, неизвестная валюта) отправляются в DLQ без повторов. Временные ошибки БД (deadlock, lock timeout, обрыв соединения) повторяются 3 раза, затем сообщение тоже уходит в DLQ.

Принятые допущения и их причины — в [DECISIONS.md](DECISIONS.md).
