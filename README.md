# Gladiator HTML

Быстрый web-прототип игры про управление гладиаторами и автобои. Первый vertical slice специально мал: два бойца сходятся на арене и обмениваются ударами. Это проверка цикла разработки, а не зафиксированный дизайн игры.

## Запуск

Нужны Node.js 22+ (или 20.19+) и npm.

```bash
npm install
npm run dev
```

Vite откроет приложение на `http://127.0.0.1:4173` и будет обновлять его без полной перезагрузки.

## Проверки

```bash
npm test                 # быстрые unit-тесты simulation
npm run test:watch       # unit-тесты в watch-режиме
npm run test:e2e         # Playwright smoke + visual screenshot
npm run test:e2e:update  # принять намеренное изменение screenshot
npm run build            # TypeScript + production build
npm run check            # всё перед передачей работы
```

Перед первым e2e-запуском может понадобиться `npx playwright install chromium`.

## Структура

- `src/simulation/` — чистые правила и состояние боя; без DOM и Three.js.
- `src/presentation/` — Three.js-сцена, которая только отображает состояние.
- `src/main.ts` — короткий runtime-loop и привязка HTML UI.
- `tests/` — Playwright smoke и эталонный screenshot.

## Ближайший roadmap

1. Выбрать главную fantasy и длительность игрового цикла по ответам игрока.
2. Проверить одну гипотезу менеджмента: найм/подготовка/ставка перед боем.
3. Добавить один осмысленный выбор во время или между боями.
4. Только после подтверждения цикла углублять статы, экипировку, AI и контент.

Правило проекта: playable slice важнее идеальной архитектуры, но simulation остаётся независимой от renderer-а.
