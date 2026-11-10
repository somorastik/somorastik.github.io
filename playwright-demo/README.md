# Task List: a Playwright demo

A small task list web app, plus an end-to-end test suite for it written with [Playwright](https://playwright.dev/). The app is deliberately simple, so this repository is mostly about **how the tests are set up**: what each file does, how the tests find things on the page, how they run in several browsers, and how GitHub Actions runs them on every push.

**Try the app:** https://somorastik.github.io/playwright-demo/

![The Task List app with four tasks, two of them ticked off](https://somorastik.github.io/assets/playwright-demo.jpg)

---

## Contents

1. [What the app does](#what-the-app-does)
2. [Files in this branch](#files-in-this-branch)
3. [Running it yourself](#running-it-yourself)
4. [How the test setup works](#how-the-test-setup-works)
   - [The pieces](#the-pieces)
   - [What happens when you run `npm test`](#what-happens-when-you-run-npm-test)
   - [The configuration, line by line](#the-configuration-line-by-line)
   - [Anatomy of a test](#anatomy-of-a-test)
   - [Finding elements: locators](#finding-elements-locators)
   - [Checking results: web-first assertions](#checking-results-web-first-assertions)
   - [Keeping tests independent](#keeping-tests-independent)
5. [What the suite covers](#what-the-suite-covers)
6. [Continuous integration](#continuous-integration)
7. [When a test fails](#when-a-test-fails)
8. [Adding a test of your own](#adding-a-test-of-your-own)
9. [Lessons this small suite already taught](#lessons-this-small-suite-already-taught)
10. [How this fits into the site](#how-this-fits-into-the-site)

---

## What the app does

- Type a task and press **Add** (or Enter) to put it on the list. Blank input is refused with a message, and spaces around the text are trimmed.
- Tick a task off, or untick it. A counter shows how many are left ("1 task left", "3 tasks left").
- Filter the list: **All**, **Active** or **Done**.
- Delete one task, or remove all finished tasks with **Clear done**.
- Tasks are saved in the browser's `localStorage`, so they are still there after a reload. If the saved data is missing or damaged, the app starts with an empty list instead of breaking.

The app is plain HTML, CSS and JavaScript with no framework and no build step: `index.html`, `app.css` and `app.js`.

## Files in this branch

```
.
├── index.html                 the page
├── app.css                    styles (same colours and fonts as the rest of the site)
├── app.js                     the app's behaviour
├── serve.js                   a tiny static web server used while testing
├── package.json               the one dependency (@playwright/test) and the npm scripts
├── package-lock.json          exact dependency versions, so every machine installs the same thing
├── playwright.config.js       how Playwright runs: browsers, web server, reports, retries
├── tests/
│   └── tasks.spec.js          the tests
└── .github/workflows/
    ├── playwright.yml         runs the tests on GitHub Actions
    └── sync-to-site.yml       copies this branch onto the site (see the last section)
```

Folders Playwright creates while it runs are listed in `.gitignore` and never committed: `node_modules/`, `test-results/` (screenshots and traces of failures) and `playwright-report/` (the HTML report).

## Running it yourself

You need [Node.js](https://nodejs.org/) 20 or newer (Playwright 1.65 requires it).

```bash
git clone --branch playwright-demo https://github.com/somorastik/somorastik.github.io.git playwright-demo
cd playwright-demo
npm ci                              # installs @playwright/test, exactly as pinned in package-lock.json
npx playwright install --with-deps  # downloads Chromium, Firefox and WebKit, plus the system libraries they need
```

`--with-deps` installs operating-system packages, so on Linux it asks for `sudo`. If you can't use `sudo`, `npx playwright install chromium` downloads Chromium alone, and `npm run test:chromium` runs only the Chromium tests.

Then:

| Command | What it does |
|---|---|
| `npm test` | Runs every test in every browser, without opening a window ("headless"). |
| `npm run test:chromium` | Runs the tests in Chromium only. The quickest check. |
| `npm run test:headed` | Runs in Chromium with a visible window, so you can watch the clicks and typing. |
| `npm run test:ui` | Opens Playwright's UI mode: pick tests, run them, and step back and forward through each one. |
| `npm run test:debug` | Opens the Playwright Inspector and pauses before each step. |
| `npm run report` | Opens the HTML report from the last run. |
| `npm start` | Serves the app at http://localhost:4173/ so you can use it by hand. |

Arguments after `--` go straight to Playwright. For example, `npm test -- -g "filters"` runs only tests whose title contains "filters", and `npm test -- --project=firefox` runs only in Firefox.

## How the test setup works

### The pieces

There are three moving parts:

1. **The app**: static files with nothing to compile.
2. **A web server** (`serve.js`): the tests need the app at a real `http://` address, because browsers limit what pages opened from `file://` can do (`localStorage`, for one, behaves differently). `serve.js` is about 30 lines of plain Node.js, so the project needs no extra packages for this.
3. **Playwright Test** (`@playwright/test`): the test runner. It starts the browsers, runs the tests in parallel, waits for the page to settle, and writes the reports.

### What happens when you run `npm test`

```
npm test
  └─ playwright test
       ├─ reads playwright.config.js
       ├─ starts `node serve.js` and waits until http://localhost:4173/ answers   (webServer)
       ├─ finds the test files in tests/                                          (testDir)
       ├─ for each project (chromium, firefox, webkit, mobile):
       │     for each test, in parallel worker processes:
       │       ├─ opens a fresh browser context (a clean, private profile)
       │       ├─ runs beforeEach: page.goto('/')
       │       ├─ runs the test's steps and assertions
       │       └─ on failure: saves a screenshot (and, on a retry, a trace)
       ├─ prints a line per test to the terminal, and writes playwright-report/   (reporter)
       └─ stops the web server
```

The suite has 14 tests and the config has 4 projects, so one full run executes 56 tests.

### The configuration, line by line

`playwright.config.js` is commented in place. These are the settings that matter most:

| Setting | Value | Why |
|---|---|---|
| `testDir` | `./tests` | Playwright looks here for `*.spec.js` files. |
| `fullyParallel` | `true` | Tests run in parallel even within one file. They can, because each one has its own browser context (see [Keeping tests independent](#keeping-tests-independent)). |
| `forbidOnly` | on CI | `test.only(...)` is handy while you write a test, but if it's committed by accident only that test would run. On CI it fails the build instead. |
| `retries` | 2 on CI, 0 locally | A retry absorbs rare timing noise on shared CI machines. Locally you want to see a failure the first time. A test that passes only on a retry is reported as **flaky**, so the problem doesn't go unnoticed. |
| `workers` | 2 on CI | GitHub's runners have few CPU cores. Locally, Playwright picks a number from your CPU count. |
| `reporter` | `list` + `html` | The list prints progress in the terminal. The HTML report is a browsable page with every test, its steps, timings and failure attachments. |
| `use.baseURL` | `http://localhost:4173/` | Lets tests write `page.goto('/')` instead of a full address. |
| `use.trace` | `on-first-retry` | A trace records every action, a DOM snapshot before and after it, network requests and console output. It costs time to record, so Playwright only records one when a test failed once and is being retried. |
| `use.screenshot` | `only-on-failure` | Attaches a picture of the page at the moment a test failed. |
| `projects` | Chromium, Firefox, WebKit, Pixel 7 | The same tests run in all three browser engines (WebKit is the engine behind Safari) and in a phone-sized Chromium with touch input. `devices[...]` sets the viewport, user agent and touch support for each. |
| `webServer` | `node serve.js` | Starts the app before the tests and stops it afterwards. `reuseExistingServer` lets you keep `npm start` running in another terminal while you work, and Playwright uses it instead of starting a second server. |

### Anatomy of a test

```js
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');                                   // 1. open the app (baseURL + '/')
});

test('adds a task with the Add button', async ({ page }) => {
  await page.getByLabel('New task').fill('Order the PCBs');       // 2. act like a user
  await page.getByRole('button', { name: 'Add' }).click();

  await expect(taskItems(page)).toHaveText(['Order the PCBs']);   // 3. check what they'd see
  await expect(page.getByText('1 task left')).toBeVisible();
});
```

- `test(title, fn)` declares a test. `test.describe(title, fn)` groups related tests, and the group's name becomes part of each test's full title in the report (for example "adding tasks › adds a task with the Add button").
- `{ page }` is a **fixture**. Playwright creates a fresh page in a fresh browser context for every test and hands it in. You never launch or close browsers yourself.
- `test.beforeEach` runs before every test in its scope. The file-level one opens the app. The `working with tasks` group adds a second `beforeEach` that creates two tasks, so the tests in that group start with something to tick off, filter and delete.
- Every browser action returns a promise, so each line is `await`ed.

The spec file also has two small helpers, `addTask(page, text)` and `taskItems(page)`, so the tests read like the steps a person would take. In a bigger suite these would grow into a *page object*: a class that wraps one page's locators and actions.

### Finding elements: locators

A **locator** describes how to find an element. It is evaluated when it's used, not when it's created, so it always looks at the page as it is at that moment.

The tests find things the way a person does, by role and visible name, rather than by CSS class or element ID:

| Locator | Finds |
|---|---|
| `page.getByLabel('New task')` | the text box that the "New task" label belongs to |
| `page.getByRole('button', { name: 'Add' })` | the button whose accessible name is "Add" |
| `page.getByRole('checkbox', { name: 'Print the case' })` | that task's checkbox. It's wrapped in a `<label>` with the task's text, which gives it its name. |
| `page.getByRole('button', { name: 'Delete Print the case' })` | that task's delete button, named by its `aria-label` |
| `page.getByRole('list', { name: 'Tasks' }).getByRole('listitem')` | every task row. A locator can be chained to search inside another one. |
| `page.getByRole('alert')` | the error message under the input |
| `page.getByText('2 tasks left')` | the counter |

Why this way:

- **The tests survive restyling.** Renaming a CSS class or restructuring the markup doesn't break them. Changing what a user sees does, and it should.
- **They double as an accessibility check.** If a button has no accessible name, a screen reader can't announce it, and a test can't find it either. Writing the tests this way pushed the app to give every control a proper name: the delete buttons got `aria-label`s, the list got `aria-label="Tasks"`, and the filter group is a labelled `role="group"`.

One CSS locator remains, on purpose: `page.locator('#tasks b')` checks that typing `<b>bold</b>` does **not** create a real `<b>` element, which there's no role for.

### Checking results: web-first assertions

```js
await expect(page.getByText('1 task left')).toBeVisible();
```

`expect(locator)` assertions **retry**. Playwright keeps checking until the condition holds or 5 seconds pass, so the tests never need `sleep`s or guesses about how long a re-render takes. The same goes for actions: before `click()`, Playwright waits until the element is attached, visible, stable, enabled and not covered by another element.

The suite uses: `toHaveTitle`, `toBeVisible`, `toBeHidden`, `toHaveCount`, `toHaveText` (given an array, it checks every matching element in order), `toHaveValue`, `toBeFocused`, `toBeChecked`, `toBeEnabled`, `toBeDisabled` and `toHaveAttribute`. Each can be negated with `.not`.

### Keeping tests independent

Every test gets a new **browser context**: a private, empty profile with its own cookies and `localStorage`. So:

- no test sees tasks another test created, and no test needs to clean up after itself;
- tests can run in any order and in parallel;
- a test that wants saved data creates it. The persistence test adds tasks and then calls `page.reload()`. The broken-data test writes junk into storage with `page.evaluate(() => localStorage.setItem(...))` and then reloads.

## What the suite covers

14 tests in `tests/tasks.spec.js`, each run in 4 browser projects:

| Group | Test | Checks |
|---|---|---|
| first visit | shows the page and an empty list | title, heading, empty message, "0 tasks left", **Clear done** disabled |
| adding tasks | adds a task with the Add button | the task appears; counter, empty message |
| | adds a task with the Enter key and clears the input | Enter submits; input is emptied and keeps focus |
| | keeps tasks in the order they were added | order and the plural counter |
| | trims spaces around the text | `"   Check the BOM   "` is saved as `"Check the BOM"` |
| | refuses an empty task and says why | blank input shows an alert and adds nothing; the alert clears when you type |
| | shows task text as plain text, never as HTML | `<b>bold</b>` shows as text and creates no element (no HTML injection) |
| working with tasks | ticks a task off and back on | checkbox state, counter, **Clear done** enabled |
| | deletes a task | only the deleted task disappears |
| | filters by Active and Done | each filter shows the right tasks; the pressed button is marked `aria-pressed="true"` |
| | shows a message when a filter has nothing in it | "No finished tasks." |
| | clears every finished task at once | list empties; **Clear done** is disabled again |
| saving | keeps tasks and their state after a reload | text, order and ticks survive a reload |
| | starts empty if the saved data is broken | damaged `localStorage` doesn't crash the app, and it still works |

## Continuous integration

`.github/workflows/playwright.yml` runs the suite on GitHub Actions on every push and pull request to this branch, and on demand from the **Actions** tab (**Run workflow**). The job:

1. checks out the branch;
2. sets up Node.js 22, caching npm's downloads between runs;
3. runs `npm ci`, a clean install of exactly the versions in `package-lock.json`;
4. runs `npx playwright install --with-deps` to get all three browsers and their Linux libraries;
5. runs `npx playwright test`. GitHub sets `CI=true`, which turns on the CI settings in the config: retries, two workers and `forbidOnly`;
6. uploads `playwright-report/` as an artifact named **playwright-report**, kept for 14 days. It's uploaded even when tests fail (`if: !cancelled()`), because that's when you need it most.

A failing test fails the job, which shows a red ✗ on the commit and blocks the pull request if branch protection requires the check.

## When a test fails

1. **Read the terminal output.** Playwright prints the failing assertion with *Expected* and *Received* values, the line of the test that failed, and a call log of what it waited for.
2. **Open the report**: `npm run report` locally, or on CI download the **playwright-report** artifact from the run's summary page, unzip it and run `npx playwright show-report path/to/playwright-report`. Each failed test has its screenshot attached.
3. **Open the trace** if the test was retried. In the report, click the trace attachment, or run `npx playwright show-trace test-results/<test>/trace.zip`. You can step through every action, see the page before and after each one, and inspect the DOM, console and network at that moment.
4. **Watch it run** with `npm run test:headed -- -g "<part of the title>"`, or step through it with `npm run test:debug`.

## Adding a test of your own

1. Open `tests/tasks.spec.js` (or create another `*.spec.js` file in `tests/`).
2. Add a `test('describes the behaviour', async ({ page }) => { ... })` inside the `describe` group it belongs to.
3. To write the steps for you, run `npx playwright codegen http://localhost:4173/` (with `npm start` running in another terminal). Click around and Playwright writes the matching code with role-based locators. Copy what you need and add `expect` assertions for what should be true afterwards.
4. Run just your test while you work: `npm run test:headed -- -g "describes the behaviour"`.
5. Run the full suite with `npm test` before you push.

## Lessons this small suite already taught

The first run of the suite failed on two mistakes, both common enough to be worth writing down:

- **Role names match by substring, ignoring case.** `getByRole('button', { name: 'Done' })` matched both the **Done** filter and **Clear done**. Playwright refuses to click when a locator matches more than one element ("strict mode violation"), which is how this showed up. The filter buttons now use `{ name: 'Done', exact: true }`.
- **`toHaveText` checks all of an element's text.** Each task row's text originally ended in "×" from the delete button, so `"Order the PCBs"` failed against `"Order the PCBs×"`. The button now draws its × as an SVG icon. It still has its `aria-label`, so screen readers and the tests can find it, but it adds no text to the row.

## How this fits into the site

[somorastik.github.io](https://somorastik.github.io/) is served by GitHub Pages from the `main` branch, and every project there lives in its own branch. This branch's copy of `sync-to-site.yml` runs on every push here: it copies this branch into the `playwright-demo/` folder on `main` (leaving out `.github/`) and asks GitHub Pages to rebuild. To change the app or the tests, work in this branch, not in `main`'s `playwright-demo/` folder, because the next sync overwrites that folder.

The copied folder also contains the test files, `package.json` and `serve.js`. They're harmless on the live site, and they let you see the tests next to the app they test.
