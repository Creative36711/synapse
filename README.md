# Synapse

Проект на **Godot 4.7.2**.

## Godot для ИИ-агентов (и людей)

В репозитории лежит готовая сборка Godot (редактор: 2D + 3D, все стандартные модули, импорт ассетов),
поэтому скачивать или компилировать движок не нужно — даже в песочницах без интернета, видеокарты и экрана.

```bash
tools/godot/install.sh --check          # установка за секунды + проверка (рендерит 3D-сцену в скриншот)
export PATH="/tmp/synapse-godot/bin:$PATH"
godot --version
```

Подробная инструкция для агентов: **[AGENTS.md](AGENTS.md)**.

| Путь | Что это |
|---|---|
| `tools/godot/dist/` | Сжатый бинарник Godot + SwiftShader (программный Vulkan) + контрольные суммы |
| `tools/godot/install.sh` | Установка в `/tmp/synapse-godot` и обёртка `godot` (сама выбирает режим с окном или без) |
| `tools/godot/agent_bridge/` | Аддон, чтобы агент мог управлять запущенной игрой и делать скриншоты |
| `tools/godot/smoke_test/` | Проверочная 3D-сцена (импорт, рендер, ввод, скриншоты) |
| `tools/godot/patches/` | Патчи к официальному Godot 4.7.2 (offscreen-драйвер, фикс кернинга, совместимость с glibc 2.35) |
| `tools/godot/build_from_source.sh`, `package.sh` | Пересборка движка из исходников и упаковка в `dist/` |
| `tools/media/` | Вырезание хромакея (+ приёмка `media-check`, ffmpeg). Гайд — [`tools/media/GENERATION_GUIDE.md`](tools/media/GENERATION_GUIDE.md) |
| `tools/modeling/` | Blender 4.5 без экрана (`bpy`): 3D-модели, GLB/gltf-экспорт, Cycles CPU-рендер |

## Медиа: вырезание фона (хромакей)

```bash
tools/media/setup.sh --check              # venv /tmp/synapse-media: Pillow + тесты
export PATH="/tmp/synapse-media/bin:$PATH"
cutout-chromakey in.png out.png --mode auto --crop   # хромакей #00FF00 (бирюзу не ест)
```

Гайд по пайплайну — [`tools/media/GENERATION_GUIDE.md`](tools/media/GENERATION_GUIDE.md)
(перенесён из narthex: генерация на #00FF00, строгий ключ, --heal, зачистка полостей).

## 3D-модели: Blender без экрана

```bash
tools/modeling/setup_bpy.sh --check       # venv /tmp/synapse-bpy: Blender 4.5.3 + стопы для песочниц
export SYNAPSE_BPY_PY=/tmp/synapse-bpy/bin/bpy-python
$SYNAPSE_BPY_PY my_model.py               # сценарий Blender: геометрия, материалы, GLB-экспорт, рендер
```

Верифицируйте: куб с материалом → GLB (проверен по accessor min/max и нодовой матрице), Cycles
CPU-рендер в PNG. Подробности — в [AGENTS.md](AGENTS.md), §5.
