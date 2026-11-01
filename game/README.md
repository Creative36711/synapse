# Coin Rush — тест «ИИ делает и играет в игру на Godot»

Простая 2D-игра на Godot 4.7.2: синий квадрат собирает 10 монет и уворачивается от красных врагов
(стрелки — движение, Enter — заново). 3 жизни, после удара 1.5 с неуязвимости.

## Как это запускалось в песочнице без GPU и без X11
* Godot 4.7.2-stable собран из официальных исходников (`tools/build_godot.sh`, шаблон `template_debug`,
  только нужные модули, ~10 мин на 2 ядрах).
* `tools/godot-4.7.2-offscreen.patch` — патч к движку:
  * новый дисплей-драйвер `offscreen`: настоящий Vulkan RenderingDevice рисует в swapchain
    поверхности `VK_EXT_headless_surface` — окна нет, а рендер настоящий;
  * бэкпорт фикса из upstream master: `TextServerFallback` не делил кернинг FreeType (26.6) на 64,
    из-за чего текст ≥24px «разъезжался» (видно на `screenshots/10_win.png`).
* Программный Vulkan — SwiftShader (`libvulkan.so.1` + `libvk_swiftshader.so` из npm-пакета
  `@sparticuz/chromium`, файл `bin/swiftshader.tar.br`), распакован в `/tmp/vk`.
* `bot.gd` (autoload) — «пульт»: читает команды из `/tmp/game_ctl/cmd.txt`, шлёт в движок настоящие
  события клавиатуры (`InputEventKey`), делает скриншоты и держит игру на паузе, пока команд нет.

```bash
tools/run_game.sh &                       # запустить игру
tools/send.sh "hold right 0.5" "hold down+left 0.3" "shot /tmp/s.png"   # сыграть ход и снять кадр
```

## Скриншоты (`screenshots/`)
* `01`–`10` — партия до победы (10/10 монет, 3 жизни); на `10_win.png` ещё виден баг кернинга.
* `11`–`15` — нарочный проигрыш для проверки экрана «GAME OVER» (уже с исправленным движком), `16` — рестарт.
