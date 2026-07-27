# Ikariam Userscripts — Complete Reference for AI-Assisted Development

> **Purpose:** Read this file at the start of every session. After reading it you need no further context about Ikariam or how these userscripts work. Just ask what needs to be built.

---

## 1. The Game — Ikariam

Ikariam is a browser-based city-building strategy game by Gameforge (`ikariam.gameforge.com`). Players build and manage ancient Greek island cities, trade resources, recruit armies, research technologies, and fight other players. The game runs entirely in the browser and exposes its state through a JavaScript model object (`window.ikariam`).

### Resources

Five resources used throughout the game:

| Index | Name    | Tech name | Luxury good? |
|-------|---------|-----------|--------------|
| 0     | Wood    | wood      | No (base)    |
| 1     | Wine    | wine      | Yes          |
| 2     | Marble  | marble    | Yes          |
| 3     | Crystal | glass     | Yes          |
| 4     | Sulfur  | sulfur    | Yes          |

Wood is produced on every island. Each island has exactly one luxury resource (Wine/Marble/Crystal/Sulfur), identified by `tradegood` (1-4).

### Cities

A player owns one or more cities, each on an island. Key city properties accessible from `window.ikariam.model`:

- `id` — numeric city ID used in URL parameters
- `name` — city name string
- `coords` — coordinate string e.g. `"[42:17]"`
- `tradegood` — luxury resource of the island (int 1-4)
- `level` — town hall level (also reflects city visual size)
- `ownerName`, `ownerAllyTag`, `ownerAllyId` — player/alliance info

### Islands

Each island has:
- A fixed `tradegood` (1=Wine, 2=Marble, 3=Crystal, 4=Sulfur)
- A list of cities with their player/alliance/state info
- A `wonder` (int) and `wonderName`
- Coordinates `x`, `y`

### Player States

The `state` field on a city/player object reflects activity:
- `"vacation"` — player is in vacation mode (city semi-immune)
- `"inactive"` — player has not logged in for some days (can be farmed)
- `"banned"` — account banned

### Buildings

Key buildings and their internal code names — relevant for reading DOM state, understanding game view names, and interpreting `ikariam.getScreen().data`:

| Building code     | What it does                               |
|-------------------|--------------------------------------------|
| `townhall`        | Sets city level / population cap           |
| `warehouse`       | Increases storage capacity                 |
| `port`            | Ships, trade range                         |
| `branchOffice`    | Marketplace — buy/sell to other players    |
| `barracks`        | Recruit land units                         |
| `shipyard`        | Recruit ships                              |
| `tavern`          | Wine consumption / satisfaction            |
| `museum`          | Cultural treaties                          |
| `temple`          | Miracle activation                         |
| `academy`         | Research                                   |
| `palace`/`colony` | Allows founding new cities                 |

Building slots are indexed 0-15 (`position[0..15]`). Position 17 is special — it holds the Pirate Fortress.

### The Game's HTTP API

All game actions are triggered via `index.php` with query parameters. Relevant patterns:

- `view=city&cityId=123` — fetch city view
- `view=island&islandId=456` — fetch island view
- `action=CityScreen&function=...` — perform a city action
- `ajax=1` on most requests returns a JSON command array instead of full HTML
- `actionRequest=REQUESTID` — CSRF token that must be included in every game POST action

AJAX responses are JSON arrays of commands. The structure:
```json
[["changeView", ["templateName", "<html...>"]], ["updateGlobalData", {...}]]
```
- `data[0][1]` — often contains global update data (time, resources)
- `data[1][1][1]` — often the view HTML string
- `data[1][1][2]["viewScriptParams"]` — JS parameters for the view

The `actionRequest` CSRF token is available in the page as a global: `ikariam.getTemplateData().actionRequest` or from form fields.

---

## 2. The Client-Side Model — `window.ikariam`

The game exposes a global `window.ikariam` object that userscripts interact with. It is **not immediately available** on page load — it is populated by the game's own scripts after the page renders.

### Key namespaces

```js
window.ikariam.model              // game state (cities, resources, player info)
window.ikariam.getScreen()        // current view/screen object
window.ikariam.getScreen().data   // data for the current view
window.ikariam.getTemplateData()  // alias for current screen data (view name, params)
window.ikariam.controller         // handles AJAX requests and routing
```

### `ikariam.model` — proven accessible fields

```js
// Own cities (from navigation-enhancer.user.js)
ikariam.model.relatedCityData              // object keyed by "city_<id>"
ikariam.model.relatedCityData.selectedCity // key of the currently active city

// Per-city entry
const city = ikariam.model.relatedCityData['city_123'];
city.id           // numeric city ID
city.name         // city name
city.coords       // "[x:y]"
city.tradegood    // int 1-4

// Current screen
ikariam.getTemplateData().view   // e.g. 'pirateFortress', 'city', 'island'
```

### `ikariam.getScreen().data` — island view (proven from island-view-enhancer)

```js
const data = ikariam.getScreen().data;
data.cities        // object keyed by city slot id
data.cities[id]    // city entry with: type, id, name, ownerName, ownerAllyTag, ownerAllyId, level, state
data.cities[id].type          // 'city' or null/empty for empty slots
data.cities[id].state         // 'vacation', 'inactive', 'banned', or undefined
data.cities[id].ownerAllyId   // alliance id string
```

### Navigating between cities

The game uses a form submission pattern — proven working in `navigation-enhancer.user.js`:

```js
$('#js_cityIdOnChange').val(cityId);
$('#changeCityForm').trigger('submit');
```

### Calling the game's AJAX layer

The game uses `ajaxHandlerCall` to fetch views. Proven pattern from `report-enhancer.user.js`:

```js
ajaxHandlerCall('?view=militaryAdvisorCombatList&activeTab=tab_militaryAdvisorCombatList&reportsPage=0');
```

To hook into AJAX calls (intercept all outgoing requests):

```js
window.ikariam.controller.executeAjaxRequestParent = window.ikariam.controller.executeAjaxRequest;
window.ikariam.controller.executeAjaxRequest = function(url, callback, data, async) {
    const params = new URLSearchParams(url);
    // inspect params.get('view'), params.get('activeTab'), etc.
    return window.ikariam.controller.executeAjaxRequestParent.call(
        window.ikariam.controller, url, callback, data, async
    );
};
```

### Parsing AJAX responses

AJAX responses are JSON arrays of commands. Proven parsing pattern from `report-enhancer.user.js`:

```js
function parseAjaxResponse(data) {
    data = JSON.parse(data);
    let html = null;
    data.forEach(function(dataPart) {
        if (dataPart[0] === 'changeView') {
            html = $('<div>' + dataPart[1][1] + '</div>');
        }
    });
    return html;
}
```

---

## 3. Shared Library — `waitForIkariamModel`

In the upstream Ikariam userscript repo, this is a shared utility that exposes `window.__IkariamWaitLib`. In this repository, the same intent is implemented locally inside `empire_overview.user.js` because the script does not depend on the external helper.

### Local equivalent used here

The script defines a small compatibility layer around the game model:

```js
var __cachedModel = null;

function getCachedModel() {
  try {
    __cachedModel = (unsafeWindow && unsafeWindow.ikariam && unsafeWindow.ikariam.model) || null;
  } catch (e) {
    __cachedModel = null;
  }
  return __cachedModel;
}

function whenModelReady(cb) {
  var p = Promise.resolve(getCachedModel());
  return typeof cb === 'function' ? p.then(cb) : p;
}
```

### Behavior

- Reads `unsafeWindow.ikariam.model` directly when available.
- Stores the latest value in `__cachedModel`.
- Resolves immediately with the current model, so callers can continue without polling.
- Provides the same practical interface as the cross-repo helper: `whenModelReady(cb)` and `getCachedModel()`.

### Why this is documented here

This repo's userscript relies on the live game model from `unsafeWindow`, and the local helper keeps the logic self-contained while preserving the same role as the external `waitForIkariamModel` utility from the other repository.

---

## 4. Userscript File Structure

### Metadata block

Every userscript starts with a Tampermonkey metadata block:

```js
// ==UserScript==
// @name         Ikariam My Feature
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  One-line description
// @author       YourName
// @match        https://*.ikariam.gameforge.com/*
// @icon         https://www.google.com/s2/favicons?domain=ikariam.com
// @grant        none
// @require      https://github.com/jacobped/ika-scripts/raw/refs/heads/master/src/js/waitForIkariamModel.user.js
// ==/UserScript==
```

### `@match` patterns — proven examples

| View | Match pattern |
|------|---------------|
| World map | `https://*.ikariam.gameforge.com/*?view=worldmap_iso*` or `*://*.ikariam.gameforge.com/?view=worldmap_iso*` |
| Island view | `https://*.ikariam.gameforge.com/?view=island*` |
| All pages | `https://*.ikariam.gameforge.com/*` |

### `@grant` values used in this repo

| Grant | Used for |
|-------|----------|
| `none` | Default — no special privileges needed |
| `GM_log` | Logging to Tampermonkey console |
| `GM_notification` | Desktop notifications (check-island-slots) |
| `GM.xmlHttpRequest` | Cross-origin HTTP requests (pirates-helper) |

### IIFE wrapper

All scripts wrap their logic in an IIFE:

```js
(function() {
    'use strict';
    // ... script body ...
})();
```

### Standard init pattern

```js
(function() {
    'use strict';

    function init() {
        // setup DOM, bind events, etc.
    }

    const lib = typeof __IkariamWaitLib !== 'undefined' ? __IkariamWaitLib : window.__IkariamWaitLib;
    if (!lib) console.warn('MyScript: wait-for-ikariam-model lib not loaded');
    else lib.waitForIkariamModel().then(() => init());
})();
```

---

## 5. DOM Patterns — What the Game Renders

### City slots (city view)

Building positions 0-16 are rendered as `#js_CityPosition{N}Link`. Position 17 is used for the Pirate Fortress:

```js
const slot17 = document.getElementById('js_CityPosition17Link');
slot17.title.includes('Pirate Fortress');  // check if pirate fortress is there
slot17.click();                             // open it
```

### Island tile (world map / island list)

```js
$(".islandTile[title='IslandName [x:y]']")  // find island by name+coords
$(".islandTile").find(".cities")             // number of cities on the island
```

### City location (island view)

```js
$('#cityLocation' + id)                    // city container
$('#js_cityLocation' + id + 'Link')        // clickable city link
$('#js_cityLocation' + id + 'TitleText')   // city title text span
$('#cityLocation' + id + 'Scroll')         // scroll/enter element
Scroll.hasClass('can_be_entered')          // own city check
```

### Navigation form (switching cities)

```js
$('#js_cityIdOnChange')   // hidden input for city ID
$('#changeCityForm')      // form to submit
```

### Sidebar (city popup)

```js
$('#sidebar')                                        // sidebar container
$('#sidebar .accordionItem .cityactions')            // action buttons area
```

### Combat report list

```js
$('#combatList tr.green')   // won battles
$('#combatList tr.red')     // lost battles
```

### Captcha

```js
$('#captcha').length > 0    // captcha is present
$("a.button.capture")       // pirate capture button (visible when no captcha)
```

---

## 6. jQuery Usage

Ikariam ships jQuery on all pages. Scripts use `$` directly — no need to import or declare it. The `@grant none` scripts can use the page's own jQuery instance.

The `check-island-slots` script additionally `@require`s jQuery 3.3.1 explicitly because its `@match` pattern targets the world map where the game's jQuery may not yet be available:

```js
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js
```

Do not add this to scripts that already run in full page context where `$` is available.

---

## 7. Logging

Use `GM_log` for debugging output. Scripts define a wrapper to gracefully degrade:

```js
function gm_log(/* ...args */) {
    const args = Array.prototype.slice.call(arguments);
    try {
        if (typeof GM_log === 'function') { GM_log.apply(null, args); return; }
    } catch (e) {}
    try { console.log('[MyScript]', ...args); } catch (e) {}
}
```

When `GM_log` is used, `@grant GM_log` must be declared in the metadata block.

---

## 8. Cross-Origin Requests

When a script needs to make HTTP requests to external domains (e.g. a captcha-solving API), use `GM.xmlHttpRequest`:

```js
// @grant        GM.xmlHttpRequest
```

```js
GM.xmlHttpRequest({
    url: 'https://example.com/api',
    method: 'POST',
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: 'key=value',
    onload: function(response) {
        const res = JSON.parse(response.responseText);
        // handle res
    }
});
```

Note: `GM.xmlHttpRequest` (dot notation) is the modern API. The legacy `GM_xmlhttpRequest` (underscore) also exists but is less consistent across managers.

---

## 9. Desktop Notifications

```js
// @grant        GM_notification
```

```js
GM_notification({
    title: 'Slot Available!',
    text: 'Island has a free city slot.',
    timeout: 8000
});
```

Used in `check-island-slots` as a fallback alongside an in-page notice box.

---

## 10. Persistent Storage

Scripts that need to persist data across page loads use `localStorage`:

```js
// Save
localStorage.setItem('MyScript_key', JSON.stringify(data));

// Load
const raw = localStorage.getItem('MyScript_key');
const data = raw ? JSON.parse(raw) : {};
```

Proven in `report-enhancer.user.js` (`IkariamCombatReportDB`). No special `@grant` needed for `localStorage`.

---

## 11. Waiting for Dynamic DOM Elements

When a DOM element may not yet exist (e.g. after an AJAX view change), use a `MutationObserver`-based helper. Proven pattern from `report-enhancer.user.js`:

```js
function waitForElement(selector) {
    return new Promise(function(resolve) {
        const element = document.querySelector(selector);
        if (element) { resolve(element); return; }

        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                const nodes = Array.from(mutation.addedNodes);
                for (let node of nodes) {
                    if ((node.matches && node.matches(selector)) || $(node).find(selector).length > 0) {
                        observer.disconnect();
                        resolve(node);
                        return;
                    }
                }
            });
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
    });
}
```

---

## 12. Styling Injected UI

Scripts inject styles via a `<style>` element appended to `document.head`. Proven pattern from `navigation-enhancer.user.js`:

```js
const style = $('<style>').text(`
    .my-widget {
        position: fixed;
        z-index: 99999;
        /* ... */
    }
`);
style.appendTo(document.head);
```

Use `z-index: 99999` or higher to ensure injected UI appears above game elements. The game uses various z-index layers internally.

---

## 12.5. Standard Color Palette

For consistent UI styling across userscripts, use this color palette:

| Element | Color | Hex |
|---------|-------|-----|
| Panel & Modal backgrounds | Warm beige | `#eed6ad` |
| Primary actions (Save, Add) | Green | `#559d3c` |
| Edit/Info buttons | Blue | `#137cc4` |
| Destructive actions (Remove, Delete) | Red | `#d14141` |
| Neutral/Cancel buttons | Gray | `#999` |
| Alert/Warning text | Yellow background | `#ffeb3b` |
| Alert hover | Darker yellow | `#fdd835` |

Apply these colors consistently to:
- Modal overlays: `background: #eed6ad`
- Add/Save buttons: `background: #559d3c`
- Edit buttons: `background: #137cc4`
- Remove buttons: `background: #d14141`
- Panel backgrounds: `background: #eed6ad`

Example usage (from `check-island-slots.user.js`):
```js
const panel = document.createElement('div');
panel.style.cssText = `
    background: #eed6ad;
    border: 2px solid #333;
    border-radius: 8px;
    /* ... */
`;
```

---

## 13. Existing Scripts — What Each Does

### `empire_overview.user.js` — Primary userscript

This is the main script in this repository. It:
- injects an "Empire Overview" entry into the Ikariam menu
- builds overview tables for resources, buildings, and military
- loads extra data and styling from the repo's resource modules (`programData.js` and `css.js`)
- reads the live game model through `unsafeWindow` so it can work with city and production data

### Model-readiness helper used by the script

The script keeps a local compatibility layer for the same concept as `waitForIkariamModel`:
- `getCachedModel()` reads `unsafeWindow.ikariam.model` and stores it in `__cachedModel`
- `whenModelReady(cb)` resolves immediately with the current model when available, or with the latest cached value otherwise
- This mirrors the purpose of the shared wait helper from the other repository, but remains self-contained in this repo

### Notes for future edits

- The script intentionally uses `unsafeWindow` and a local jQuery instance to avoid breaking the game's own scripts.
- The local model helper should be preserved when updating the script's data access logic.
- **Avoid modifying `data/css.js`.** This file serves as the baseline styling and is tedious to test with changes. If CSS modifications are necessary, make them directly in the userscript file (`empire_overview.user.js`) instead, where they are easier to test and iterate on.

---

## 14. URL Patterns

All game views are served from:
```
https://s{N}-{country}.ikariam.gameforge.com/index.php?{params}
```
or equivalently:
```
https://s{N}-{country}.ikariam.gameforge.com/?{params}
```

Common `view` values seen in the scripts:

| `view=` value | Description |
|---------------|-------------|
| `worldmap_iso` | Isometric world map |
| `island` | Island view (shows cities on an island) |
| `city` | City view (your own city) |
| `pirateFortress` | Pirate fortress building view |
| `militaryAdvisorCombatList` | Combat report list |
| `militaryAdvisorReportView` | Single combat report |
| `cityDetails` | City popup/sidebar |
| `avatarProfile` | Player profile |

The city ID is passed as `?view=city&cityId=123`. Island view uses `?view=island&cityId=123` (uses city ID to locate the island, not `islandId` directly, in some contexts).

---

## 15. Common Pitfalls

- **`window.ikariam` is not immediately available.** Always use `waitForIkariamModel()` before accessing it. Accessing it directly at script load time will fail.
- **`@match` must be exact.** Some scripts use `*://*.` and some use `https://*.` — be consistent and test against the actual game URL format.
- **Hardcoded alliance/server IDs.** `island-view-enhancer` has hardcoded alliance IDs that are server-specific. Note this whenever touching that file.
- **`ikariam.getScreen().data` vs `ikariam.model`.** These are different objects. `model` has global player state; `getScreen().data` has the current view's data and changes with navigation.
- **`ajaxHandlerCall` is a game global.** It exists on the page but is not part of `window.ikariam`. Call it directly: `ajaxHandlerCall('?view=...')`.
- **jQuery `$` conflicts.** If a script uses `@require` to load its own jQuery while the page already has one, there can be conflicts. The `check-island-slots` script works around this but it is worth being aware of.
- **The `waitForIkariamModel` lib must be loaded first.** Because it is a `@require`, Tampermonkey loads it before the script body. Always check `typeof __IkariamWaitLib !== 'undefined'` as shown in the existing scripts.
- **Event timing in render.Init().** The order of event subscriptions matters. DATABASE_LOADED fires when the DOM structure is created. MODEL_AVAILABLE fires when data is ready. If you need a DOM element created in DrawTables, initialize references to it in the MODEL_AVAILABLE event, not DATABASE_LOADED. This caused a silent failure where element selectors returned empty collections because the DOM didn't exist yet.

---

## 16. Post-Coding Review Protocol

After every coding session, before declaring work complete:

### Step 1: Syntax check
```bash
node --check empire_overview.user.js
```
Run for every modified file.

### Step 2: Review checklist
- [ ] Script wrapped in IIFE `(function() { 'use strict'; ... })()`
- [ ] `waitForIkariamModel()` used before any `window.ikariam` access
- [ ] Lib check pattern correct: `typeof __IkariamWaitLib !== 'undefined'`
- [ ] `@require` for the wait lib present in metadata
- [ ] `@grant` declarations match what the script actually uses
- [ ] `@match` pattern is correct for the target view
- [ ] No `window.ikariam` accessed at script load time (outside of the `.then()` callback)
- [ ] Config constants defined as `const CFG_*` at the top
- [ ] `GM_log` wrapper defined if `@grant GM_log` is used
- [ ] `setInterval` / `setTimeout` loops have sensible intervals (no tight polling)
- [ ] Injected styles use `z-index: 99999` or higher for overlay UI
- [ ] Hardcoded server/alliance IDs noted with a `// todo` comment

### Step 3: Report
Provide a summary covering:
1. What was coded (each function/change listed briefly)
2. Result of the review checklist (any issues found and fixed)
3. Any design decisions or trade-offs made
4. Any known limitations or future considerations

---

## 17. Coding Standards

Observed preferences and expectations:

- **No unnecessary comments** — only comment when the WHY is non-obvious.
- **No docstrings** — a one-liner maximum at most.
- **No error handling for impossible cases** — don't guard against things that can't happen.
- **Minimal, focused changes** — fix exactly what was asked, nothing more. Do not refactor surrounding code unless specifically requested.
- **Hardcoded values are fine temporarily** — but mark with `// todo` so they are visible.
- **Short, direct** — avoid verbose variable names or over-engineering for scripts of this size.

---

## 18. Repository Layout

```
.
├── empire_overview.user.js      ← main userscript
├── data/
│   ├── programData.js           ← resource/module data loaded by the userscript
│   └── css.js                   ← injected stylesheet data used by the userscript
├── README.md                    ← install/use notes
├── CHANGELOG.md                 ← release history
├── CHANGELOG_OLD.md             ← older changelog notes
└── LICENSE
```

This repository is a single-script userscript project. The main implementation lives in `empire_overview.user.js`, while the supporting data is stored in the `data/` folder rather than a separate `src/js/` tree.

---

## 19. Coding Conventions

Observed across the existing scripts:

1. **IIFE wrapper** — every script body is wrapped in `(function() { 'use strict'; ... })();`
2. **Class-based organisation** — non-trivial scripts use ES6 classes (`IkariamCity`, `PiratesHelper`, `IkariamCombatReportDB`, etc.)
3. **Config constants at the top** — user-configurable values declared as `const CFG_*` before any logic
4. **Lib check before init** — always check `lib` is defined before calling `waitForIkariamModel()`
5. **No module system** — scripts are self-contained; no `import`/`export` (Tampermonkey does not support ES modules natively)
6. **jQuery for DOM manipulation** — used throughout; available from the game page
7. **`GM_log` for debug output** — not `console.log` in production paths, though `console.log`/`console.warn` is acceptable for errors

---

## 20. Quick Reference — New Script Template

```js
// ==UserScript==
// @name         Ikariam My Feature
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  One-line description of what this does
// @author       YourName
// @match        https://*.ikariam.gameforge.com/*
// @icon         https://www.google.com/s2/favicons?domain=ikariam.com
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    // --- Config ---
    const CFG_SOMETHING = true;

    // --- Helpers ---
    function gm_log() {
        const args = Array.prototype.slice.call(arguments);
        try { if (typeof GM_log === 'function') { GM_log.apply(null, args); return; } } catch (e) {}
        try { console.log('[MyFeature]', ...args); } catch (e) {}
    }

    var __cachedModel = null;
    function getCachedModel() {
        try {
            __cachedModel = (unsafeWindow && unsafeWindow.ikariam && unsafeWindow.ikariam.model) || null;
        } catch (e) {
            __cachedModel = null;
        }
        return __cachedModel;
    }

    function whenModelReady(cb) {
        var p = Promise.resolve(getCachedModel());
        return typeof cb === 'function' ? p.then(cb) : p;
    }

    // --- Main ---
    function init() {
        gm_log('init called');
        // access unsafeWindow.ikariam, bind events, manipulate DOM
    }

    whenModelReady(function() {
        init();
    });
})();
```

---

*Last updated: 2026-07-25. Reflects scripts in jacobped/ika-scripts.*

