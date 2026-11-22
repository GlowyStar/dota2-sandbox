# Среда для нейросетей (reset / step)

Тот же движок, что и в массовых прогонах, но с пошаговым управлением: агент получает наблюдение, отдаёт приказы
своим юнитам, среда проматывает `dt` секунд и возвращает новое наблюдение, награду и признак конца эпизода.

## Запуск

Сервер общается построчным JSON через stdin/stdout: одна строка запроса, одна строка ответа.

```powershell
.\simlab.cmd env
```

Готовый клиент на Python без сторонних зависимостей: [`clients/python/simlab_env.py`](../clients/python/simlab_env.py).

```python
from simlab_env import SimlabEnv

scenario = {
    "units": [
        {"id": "me",  "team": 0, "unit": "juggernaut", "level": 15, "items": ["bfury"], "ai": "external"},
        {"id": "foe", "team": 1, "unit": "sven",       "level": 15, "ai": "fight"},
    ],
    "rules": {"maxTime": 60},
}
with SimlabEnv() as env:
    out = env.reset(scenario, seed=1, dt=0.2, vector=True)
    while not out.get("done"):
        out = env.step([{"unit": "me", "type": "attack", "target": "foe"}])
    print(out["winner"], out["reward"])
```

Из JavaScript среду можно использовать и без сервера: `import { Env } from './src/env.mjs'`.

## Кто кем управляет

- Юнит со значением `"ai": "external"` в сценарии управляется агентом (можно также передать список id в `control` при `reset`).
- Остальные юниты ведёт встроенный ИИ (`fight`, `attack`, `idle`), поэтому противника можно оставить скриптовым
  или тоже отдать агенту (self-play: обе стороны `external`).

## Запросы

| Запрос | Ответ |
|---|---|
| `{"cmd":"make","n":8}` | `{"ids":[...]}`: создать ещё n независимых сред в этом процессе |
| `{"cmd":"reset","env":0,"scenario":{...},"seed":1,"dt":0.2,"events":false,"vector":true,"reward":{...}}` | `{"obs":..., "info":{"controlled":[...],"dt":0.2,"maxTime":60}}` |
| `{"cmd":"step","env":0,"actions":[...]}` | `{"obs":..., "reward":[r0,r1], "done":false, "winner":..., "info":{...}}` |
| `{"cmd":"step_many","envs":[0,1],"actions":[[...],[...]]}` | `{"results":[...]}`: шаг сразу в нескольких средах за один обмен |
| `{"cmd":"observe","env":0}` | текущее наблюдение без шага |
| `{"cmd":"spec"}` | список действий, раскладка вектора, формула награды |
| `{"cmd":"close"}` | завершить сервер (`"env": N` закрывает одну среду) |

Поле `id` в запросе возвращается в ответе без изменений. Ошибка приходит как `{"error":"..."}`.
`reset` без `scenario` перезапускает прежний сценарий с новым `seed`.

## Действия

```json
{"unit": "me", "type": "attack", "target": "foe"}
{"unit": "me", "type": "cast", "ability": "juggernaut_omni_slash", "target": "foe"}
{"unit": "me", "type": "cast", "ability": "juggernaut_healing_ward", "pos": [120, 40]}
{"unit": "me", "type": "cast", "ability": "black_king_bar"}
{"unit": "me", "type": "move", "pos": [300, 0]}
{"unit": "me", "type": "stop"}   {"unit": "me", "type": "hold"}   {"unit": "me", "type": "noop"}
```

Приказ действует, пока его не сменит другой: если действий для юнита в шаге нет, он продолжает прежнее.
Недопустимые действия не прерывают эпизод, а перечисляются в `info.invalid` с причиной
(способность не готова, цель мертва, юнит под молчанием и т. п.).

## Наблюдение

`obs.units` содержит по записи на каждого участника (и на живых призванных существ):

- общее: `id, unit, heroId, team, controlled, alive, level, hp, maxHp, mana, maxMana, x, y`;
- боевые числа: `armor, mr, damage, attackInterval, attackRange, moveSpeed`;
- состояния: `stunned, silenced, rooted, disarmed, hexed, immune, invulnerable, untargetable`;
- текущее действие: `order, target, casting`;
- `abilities`: `name, level, type` (`unit`, `point`, `unit_or_point`, `none`, `passive`), `cd, mana, ready, range, charges`;
- `items`: `name, type, cd, ready, charges`;
- `modifiers`: активные эффекты с `stacks`, оставшимся временем `left` и признаком `debuff`.

С `vector: true` (или `{"maxUnits":10,"maxAbilities":8,"maxItems":7}`) в ответ добавляется `vec.vector`: плоский
числовой массив фиксированной длины, по блоку на юнита. Раскладка блока возвращается запросом `spec`.

С `events: true` в `info.events` приходят записи журнала боя за шаг (урон, касты, эффекты, смерти).

## Награда и конец эпизода

`reward` содержит по числу на команду 0 и 1. По умолчанию это разница нанесённого и полученного урона
(вес `damage` = 0.001 за единицу, урон по крипам считается за 25 %), `kill` = 1 за убийство, `win` = 5 за победу.
Веса задаются в `reset`: `"reward": {"damage": 0.001, "kill": 1, "win": 5}`. Сырые величины для собственной формулы
есть в наблюдении и журнале событий.

Эпизод заканчивается, когда живые участники остались не более чем у одной команды (`winner` = её номер) или
истекло `rules.maxTime` (`winner` = -1).

## Скорость

Один процесс через Python-клиент делает около 3 000 шагов в секунду с полным наблюдением (шаг = 0,2 с игрового времени).
Для обучения запускайте несколько процессов и используйте `make` + `step_many`, чтобы шагать пачку сред за один обмен.
Для оценки готовых стратегий без пошагового управления быстрее обычные массовые прогоны (`sim_batch`).

## Ограничения

Среда наследует все упрощения движка: ровная площадка без рельефа и тумана войны, полная наблюдаемость,
нет экономики, опыта и возрождения. Степень точности каждой способности указана в `COVERAGE.md`.
