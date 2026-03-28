# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prompt Manager for IDE — a VSCode/Cursor extension for managing and quickly selecting AI prompt templates. Published on the VSCode Marketplace as `prompt-manager-for-ide`.

- **Engine:** VSCode ^1.73.0
- **Language:** TypeScript (target ES2020, strict mode)
- **Package Manager:** pnpm
- **Entry Point:** `src/extension.ts` → compiled to `out/extension.js`

## Commands

```bash
pnpm install          # Install dependencies
pnpm compile          # Build TypeScript → out/
pnpm watch            # Watch mode (auto-recompile)
pnpm lint             # ESLint (src/**/*.ts)
pnpm test             # Run tests (requires compile first; pretest does both)
pnpm run package      # Create .vsix package
```

To debug: press F5 in VSCode/Cursor to launch the Extension Development Host.

## Architecture

### Service-oriented singleton pattern

All services are singletons accessed via static `getInstance()`. The central orchestrator is `PromptManager` which coordinates all services.

```
PromptManager (src/models/PromptManager.ts)
  ├── StorageService        — VSCode globalState persistence
  ├── UIService             — Dialogs, quick picks, user interaction
  ├── ClipboardService      — Clipboard operations
  ├── ImportExportService   — JSON import/export
  ├── WebViewEditorService  — Custom WebView editor panel
  └── ChatIntegrationFactory (Factory pattern)
        ├── CursorIntegrationService
        └── VSCodeIntegrationService
```

### Key patterns

- **Factory pattern** — `ChatIntegrationFactory` uses `EditorEnvironmentDetector` to auto-detect the running IDE (Cursor vs VSCode) and instantiate the correct chat integration service.
- **Strategy pattern** — `PromptActionStrategies` (src/strategies/) defines different actions on prompts: copy, send-to-chat, insert-to-editor.
- **EventEmitter** — `PromptManager` emits events on data changes; `PromptTreeDataProvider` listens to refresh the tree view.

### Data model

- `PromptItem` — id, title, content, categoryId, tags, description
- `PromptCategory` — id, name, description, icon, sortOrder
- All data persisted in VSCode `globalState` (no external DB or files at runtime)

### Default prompts

Built-in prompts are organized under `src/constants/prompts/` by category (coding, general, writing, uidesign, llm, other). `autoLoader.ts` dynamically imports all prompt files from these directories.

### Localization

Uses VSCode's `l10n` API. Translation bundles are in `l10n/` (English + Simplified Chinese). `LocalizationService` wraps the `t()` function.

### Views

`PromptTreeDataProvider` (src/views/) implements `TreeDataProvider` for the sidebar tree view. Tree items use `contextValue` to control right-click menu visibility.
