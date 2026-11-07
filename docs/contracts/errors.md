# Коды ошибок и контракт диагностики

Ошибка ядра — это **код плюс параметры**, а не готовая фраза. Машинная часть одинакова для всех
локалей и стабильна между версиями; текст для человека берётся из каталога перевода по `catalogKey`.
Реестр — [`schema/error-registry.json`](../../schema/error-registry.json), его схема —
[`schema/error-registry.schema.json`](../../schema/error-registry.schema.json).

## Формат

```json
{
  "code": "field.unknown",
  "params": {
    "path": "/game/genre",
    "expected": "поле из контракта GameSpec 1.0",
    "actual": "genre"
  },
  "catalogKey": "errors.field.unknown"
}
```

- `code` — стабильный идентификатор из реестра, никогда не переводится;
- `params` — данные для подстановки; базовые три обязательны всегда (INV-6);
- `catalogKey` — строго `errors.<code>`, единственный путь к тексту (INV-9);
- локаль меняет только текст, но не `code`, не `params` и не результат проверки (INV-10).

### Базовые параметры (INV-6)

| Параметр | Смысл | Пример |
|---|---|---|
| `path` | JSON Pointer к месту в документе; для отсутствующего обязательного поля и для лишнего ключа — путь к имени ключа; `/` — корень | `/conflicts/0/reasonKey` |
| `expected` | что контракт ожидал: значение, тип, грамматика, набор | `строка SemVer 2.0.0` |
| `actual` | что реально пришло: значение или его тип | `0.1` |

Порядок `path`, `expected`, `actual` фиксирован: реестр и тест проверяют именно его. Дополнительные
параметры (`extraParams`) добавляются после базовых и не могут дублировать их имена.

## Реестр

| `code` | `stage` | `implementedIn` | params | `catalogKey` | когда |
|---|---|---|---|---|---|
| `field.unknown` | structural | K-2 | path, expected, actual | `errors.field.unknown` | лишнее поле в определении |
| `field.required` | structural | K-2 | path, expected, actual | `errors.field.required` | нет обязательного поля |
| `field.type` | structural | K-2 | path, expected, actual | `errors.field.type` | неверный тип значения |
| `field.enum` | structural | K-2 | path, expected, actual | `errors.field.enum` | значение вне закрытого набора |
| `field.pattern` | structural | K-2 | path, expected, actual | `errors.field.pattern` | не соответствует грамматике |
| `field.unique` | structural | K-2 | path, expected, actual | `errors.field.unique` | повтор в массиве без повторов |
| `yaml.duplicate-key` | structural | K-2 | path, expected, actual, key, line | `errors.yaml.duplicate-key` | повтор ключа в YAML |
| `yaml.syntax` | structural | K-2 | path, expected, actual, line, column | `errors.yaml.syntax` | файл не разбирается как YAML 1.2 |
| `definition.state.forbidden` | semantic | K-3 | path, expected, actual, field | `errors.definition.state.forbidden` | попытка хранить состояние экземпляра |
| `locale.key.missing` | semantic | K-3 | path, expected, actual, locale, catalog | `errors.locale.key.missing` | нет ключа каталога для локали |
| `module.duplicate` | semantic | K-3 | path, expected, actual, moduleId | `errors.module.duplicate` | один ID модуля объявлен дважды |
| `scene.entry.unknown` | semantic | K-3 | path, expected, actual, sceneId, moduleId | `errors.scene.entry.unknown` | запись `sceneEntries` не входит в `provides.scenes` |
| `scene.duplicate` | semantic | K-3 | path, expected, actual, sceneId, modules | `errors.scene.duplicate` | один ID сцены сопоставлен ресурсу дважды |
| `scene.resource.missing` | semantic | K-3 | path, expected, actual, sceneId, resource | `errors.scene.resource.missing` | ресурса `res://…tscn` из `sceneEntries` нет |
| `spec.file.missing` | semantic | K-3 | path, expected, actual, file | `errors.spec.file.missing` | файл спецификации не читается |
| `runtime.engine.missing` | semantic | K-3 | path, expected, actual, engine | `errors.runtime.engine.missing` | движок `run` недоступен или не отрендерил сцену |
| `cli.dependency.node-missing` | semantic | K-3 | path, expected, actual, dependency, requiredVersion | `errors.cli.dependency.node-missing` | нет Node.js, проверка не выполнена |
| `cli.usage` | semantic | K-3 | path, expected, actual, command | `errors.cli.usage` | CLI вызван без допустимой команды |
| `module.dependency.missing` | resolution | K-4 | path, expected, actual, requiredBy, constraint | `errors.module.dependency.missing` | обязательная зависимость не найдена |
| `module.dependency.cycle` | resolution | K-4 | path, expected, actual, cycle | `errors.module.dependency.cycle` | цикл в графе зависимостей (INV-5) |
| `module.version.unsatisfied` | resolution | K-4 | path, expected, actual, constraint, available | `errors.module.version.unsatisfied` | нет версии под диапазон |
| `module.conflict` | resolution | K-4 | path, expected, actual, conflictId, constraint | `errors.module.conflict` | сработал объявленный конфликт |
| `ref.unresolved` | resolution | K-4 | path, expected, actual, refKind, providedBy | `errors.ref.unresolved` | смысловой ID никем не предоставлен |

Каждая строка этой таблицы сверяется с реестром автоматически: код без строки и строка без кода —
провал `npm run check:contracts`.

## Диагностика и машинные записи CLI

CLI печатает два вида записей, и правила у них разные:

| Вид | Как печатается | Что обязано выполняться |
|---|---|---|
| **Диагностика** | с каталогом: `code`, `params`, `catalogKey`, `message` | код есть в реестре; `catalogKey = "errors." + code` без override; ключ есть во всех восьми каталогах; текст из каталога (INV-14) |
| **Машинная запись CLI** | без каталога: только `code` и `params` (`cli.run.usage`, `cli.run.option.unknown`, `cli.run.frames.invalid`, `cli.run.shot.invalid`, `cli.run.shot.directory_failed`, `cli.run.state.invalid`, `cli.run.state.capture_failed`, `cli.run.state.write_failed`, `cli.run.png.invalid`, `cli.run.option.value_missing`, а также успешная `cli.run.complete`) | код стабилен и не переводится; в реестр такой код не входит, потому что у него нет и не должно быть ключа каталога; параметры машиночитаемы |

Второй вид — протокол CLI, а не пользовательская диагностика: текста у него нет, ключа каталога тоже.
Поэтому правило «`catalogKey = errors.<code>`» к нему не применяется — не как исключение, а по
определению. Если такую запись нужно показать человеку, её сначала переводят в диагностику: строка в
реестре, ключ во всех восьми каталогах, `_emit_catalog_error` без override.

### Известные расхождения в `game/cli/main.gd` (BASE_SHA)

Расхождения зафиксированы аудитом и этой карточкой не исправляются: правка `game/**` — предмет
отдельной карточки зоны `game/**`. Каждое описано в записи решения с откатом.

| Где | Что не так | Целевое состояние |
|---|---|---|
| `_emit_node_missing` | код печатается как `cli.dependency.node_missing` (подчёркивание), а реестр знает `cli.dependency.node-missing`; расхождение скрыто override-ключом | код ровно `cli.dependency.node-missing`, без override |
| `_run_game`, рендер | код `cli.run.render_failed` отсутствует в реестре, а `catalogKey` подменён на `errors.runtime.engine.missing` | случай сообщается кодом `runtime.engine.missing` (он в реестре, ключ есть во всех каталогах), машинные детали — в `params.actual`; override не нужен |
| `_write_world_state` | тот же override на пути снимка состояния | то же: код `runtime.engine.missing` без override |

Пока расхождения не закрыты, контрактный тест перечисляет их явно: любой **новый** код мимо реестра
или **новый** override — провал `check:contracts`. Список расхождений в тесте и в записи решения
обязан совпадать, поэтому «тихо» расширить список нельзя.

## Стадии

- **structural** — форма документа: поля, типы, шаблоны, повторы, разбор YAML. Реализовано в K-2
  (схемы + правила чтения).
- **semantic** — то, что требует не только формы: существование файлов и ресурсов, смысл уже
  разобранного документа, доступность окружения проверки. Сюда входят ключи каталога, согласованность
  локалей, отсутствие состояния в определении, связь сцены с ресурсом (`scene.*`), читаемость файла
  спецификации (`spec.file.missing`) и наличие того, чем выполняется проверка
  (`runtime.engine.missing`, `cli.dependency.node-missing`). K-3.
- **resolution** — граф модулей: версии, зависимости, конфликты, циклы, ссылки. K-4.

`implementedIn` — карточка, где проверка появляется. Значение определяется стадией:
`structural → K-2`, `semantic → K-3`, `resolution → K-4`.

Стадии ровно три, и четвёртой контракт не вводит: отсутствие движка или Node.js — не «стадия
рантайма», а предусловие проверки, поэтому такие коды живут в `semantic`. Если появится отдельная
стадия `runtime`, меняется только поле `stage` (и вместе с ним `implementedIn`) — один код, одна
строка, см. [`../decisions/SYN-2.md`](../decisions/SYN-2.md).

## Тексты кодов: где они живут

Для каждого кода реестра строка `errors.<code>` существует во всех восьми каталогах
`locales/<locale>.json` (en, ru, zh-Hans, ja, pt-BR, de, fr, ko). Это не пожелание, а проверяемое
свойство: контрактный тест `tests/contracts/cli-diagnostics.test.mjs` сверяет реестр с каталогами в
обе стороны, а `npm run i18n-check` проверяет состав ключей.

Обратное тоже верно: ключ `errors.*` в каталоге без строки в реестре — расхождение. Новый ключ
появляется вместе со строкой реестра, одним изменением; иначе диагностика разъезжается с текстом
(INV-9, INV-14).

## Как добавить код

1. Код составной, нижний регистр, через точку: `<область>.<что>` (`field.*`, `yaml.*`, `module.*`).
2. `params` начинаются с `path`, `expected`, `actual`; дополнительные имена — в `extraParams`.
3. `catalogKey` всегда `errors.<code>`, без исключений и без подмены: пятого аргумента-override у
   `_emit_catalog_error` быть не должно. Ключ не придумывается отдельно от кода.
4. Стадия и карточка обязательны: код без владельца не попадает в реестр.
5. Код стадии `K-2` обязан иметь хотя бы один пример в `schema/examples/**`: неподтверждённый код не
   отличается от опечатки.
6. Текст ошибки в реестр не пишется. Поля `message`, `text`, `title` запрещены схемой реестра.

## Чего в K-2 нет

Коды `semantic` и `resolution` описаны контрактом, но не реализованы: K-2 не читает каталоги
переводов, не строит граф и не разрешает версии. Статические примеры в `schema/examples/**`
показывают, что структурная схема отсекает описанный ввод, и **не** выдаются за работу валидатора
(K-3) или резолвера (K-4). Например, цикл модулей ловится только в K-4, хотя код диагностики уже
зафиксирован здесь.

## Локаль не меняет проверку (INV-10)

Переключение локали влияет на подставленный текст и только на него: `code`, `params`, `path`,
порядок и состав ошибок остаются прежними, состояние мира не меняется. Поэтому ключи каталога
обязаны существовать для всех восьми локалей, а тесты сравнивают диагностику без учёта текста.
