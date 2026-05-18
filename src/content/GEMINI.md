# Ophelia - Content Scripts (`src/content/`)

This directory contains the scripts injected into every web page. They form the core runtime of the Ophelia assistant and tutorial system.

## Module Responsibilities

- **`content.js` (Coordinator):**
  - Bootstraps the environment and initializes other modules.
  - Handles top-level Chrome message routing.
  - Manages the visual state of the orange sphere.
- **`assistant.js` (AI Agent):**
  - Orchestrates the "Analyze -> Highlight -> Wait" loop.
  - Captures DOM state and coordinates with the background for screenshots.
  - Manages the local multi-turn conversation state.
- **`recorder.js` (Recording):**
  - Listens for user events (clicks, inputs) and builds the tutorial step list.
  - Fingerprints elements for reliable playback.
- **`player.js` (Playback):**
  - Executes tutorial steps.
  - Implements the `findElement` matching logic (ARIA labels, test IDs, text content).
- **`overlay.js` (UI Layer):**
  - Centralizes all DOM injection for UI elements (dots, target outlines).
  - Ensures Ophelia's UI doesn't interfere with the page's accessibility or layout more than necessary.

## Standards & Conventions

- **Isolation:** Content scripts share the DOM but have isolated JavaScript execution. Use `window.Ophelia...` properties sparingly to expose APIs between Ophelia modules, but avoid polluting the global `window` namespace otherwise.
- **Element Selection:**
  - When identifying elements for the AI or for tutorial playback, prioritize `aria-label`, `data-testid`, and semantic `role` over fragile CSS selectors.
  - Use `OpheliaPlayer.findElement()` for consistent matching across the project.
- **DOM Stability:**
  - Be mindful of "layout shifts". Use the 250ms repositioning delay implemented in `overlay.js` when placing dots.
  - Use high `z-index` (e.g., `2147483647`) for Ophelia UI elements to ensure they stay on top.
- **Message Passing:**
  - All complex tasks (AI calls, screenshot capture, navigation) must be delegated to the background script via `chrome.runtime.sendMessage`.
  - Content scripts should focus on UI, DOM analysis, and event interception.
- **Persistence:**
  - Use `chrome.storage.local` or `chrome.storage.session` for state that needs to survive page refreshes or cross-page navigation (e.g., active tutorial progress).
