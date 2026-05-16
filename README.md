# Trel

Современный кастомный лаунчер Minecraft: Electron + React + TypeScript.

## Возможности

- Официальная авторизация через Microsoft (msmc), плюс offline-режим для singleplayer/локальной сети
- Загрузка любой версии Minecraft напрямую с `launchermeta.mojang.com` (release, snapshot, old_beta, old_alpha)
- Автоматическая установка клиента, библиотек, ассетов и нативов через `@xmcl/core` + `@xmcl/installer`
- Настраиваемый объём памяти JVM, выбор Java, выбор игрового каталога
- Современный интерфейс (кастомный title bar, градиенты, карточки, прогресс)
- Сборка в один portable `.exe` через electron-builder

## Требования

- Node.js 18+
- Установленная Java (21 для 1.20.5+, 17 для 1.18+, 8 для старых)

## Запуск в режиме разработки

```
npm install
npm run build:electron
npm run dev          # в одной консоли — запустит Vite dev-сервер
npm start            # в другой — запустит Electron, подключится к localhost:5173
```

## Сборка portable .exe

```
npm run dist
```

Готовый файл будет в `release/Trel.exe` (portable) или `release/Trel-<version>-x64.exe` (NSIS-установщик).

## Структура

```
src/
  main/        Electron main process (окно, IPC, загрузка/запуск MC, msmc auth)
  preload/     contextBridge API для renderer
  renderer/    React UI
  shared/      Общие типы
```

## Важно

Игра Minecraft — платная. Для онлайн-игры на официальных серверах нужен купленный аккаунт Microsoft. Offline-режим работает только для singleplayer и серверов с `online-mode=false`.
