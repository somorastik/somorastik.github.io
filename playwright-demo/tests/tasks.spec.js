// @ts-check
// End-to-end tests for the Task List app.
//
// Each test gets a brand-new browser context (its own cookies and localStorage), so the tests never
// see each other's tasks and can run in any order or in parallel.
const { test, expect } = require('@playwright/test');

// Small helpers, so each test reads like the steps a person would take.
async function addTask(page, text) {
  await page.getByLabel('New task').fill(text);
  await page.getByRole('button', { name: 'Add' }).click();
}
// Filter buttons use `exact: true`: role names match by substring by default, so 'Done' would also
// match the 'Clear done' button.
const taskItems = (page) => page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('first visit', () => {
  test('shows the page and an empty list', async ({ page }) => {
    await expect(page).toHaveTitle(/Task List/);
    await expect(page.getByRole('heading', { level: 1, name: 'Task List' })).toBeVisible();
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    await expect(page.getByText('0 tasks left')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear done' })).toBeDisabled();
  });
});

test.describe('adding tasks', () => {
  test('adds a task with the Add button', async ({ page }) => {
    await addTask(page, 'Order the PCBs');

    await expect(taskItems(page)).toHaveCount(1);
    await expect(taskItems(page)).toHaveText(['Order the PCBs']);
    await expect(page.getByText('1 task left')).toBeVisible();
    await expect(page.getByText('Nothing here yet.')).toBeHidden();
  });

  test('adds a task with the Enter key and clears the input', async ({ page }) => {
    const input = page.getByLabel('New task');
    await input.fill('Solder the pots');
    await input.press('Enter');

    await expect(taskItems(page)).toHaveText(['Solder the pots']);
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
  });

  test('keeps tasks in the order they were added', async ({ page }) => {
    for (const t of ['One', 'Two', 'Three']) await addTask(page, t);
    await expect(taskItems(page)).toHaveText(['One', 'Two', 'Three']);
    await expect(page.getByText('3 tasks left')).toBeVisible();
  });

  test('trims spaces around the text', async ({ page }) => {
    await addTask(page, '   Check the BOM   ');
    await expect(taskItems(page)).toHaveText(['Check the BOM']);
  });

  test('refuses an empty task and says why', async ({ page }) => {
    await addTask(page, '    ');

    await expect(page.getByRole('alert')).toHaveText('Type a task first.');
    await expect(taskItems(page)).toHaveCount(0);

    // The message goes away as soon as you start typing.
    await page.getByLabel('New task').pressSequentially('A');
    await expect(page.getByRole('alert')).toHaveText('');
  });

  test('shows task text as plain text, never as HTML', async ({ page }) => {
    await addTask(page, '<b>bold</b>');
    await expect(taskItems(page)).toHaveText(['<b>bold</b>']);
    await expect(page.locator('#tasks b')).toHaveCount(0);
  });
});

test.describe('working with tasks', () => {
  test.beforeEach(async ({ page }) => {
    await addTask(page, 'Write the firmware');
    await addTask(page, 'Print the case');
  });

  test('ticks a task off and back on', async ({ page }) => {
    const box = page.getByRole('checkbox', { name: 'Write the firmware' });

    await box.check();
    await expect(box).toBeChecked();
    await expect(page.getByText('1 task left')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear done' })).toBeEnabled();

    await box.uncheck();
    await expect(box).not.toBeChecked();
    await expect(page.getByText('2 tasks left')).toBeVisible();
  });

  test('deletes a task', async ({ page }) => {
    await page.getByRole('button', { name: 'Delete Print the case' }).click();
    await expect(taskItems(page)).toHaveText(['Write the firmware']);
  });

  test('filters by Active and Done', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Print the case' }).check();

    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(taskItems(page)).toHaveText(['Write the firmware']);

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(taskItems(page)).toHaveText(['Print the case']);

    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(taskItems(page)).toHaveCount(2);
  });

  test('shows a message when a filter has nothing in it', async ({ page }) => {
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(taskItems(page)).toHaveCount(0);
    await expect(page.getByText('No finished tasks.')).toBeVisible();
  });

  test('clears every finished task at once', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Write the firmware' }).check();
    await page.getByRole('checkbox', { name: 'Print the case' }).check();
    await page.getByRole('button', { name: 'Clear done' }).click();

    await expect(taskItems(page)).toHaveCount(0);
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear done' })).toBeDisabled();
  });
});

test.describe('saving', () => {
  test('keeps tasks and their state after a reload', async ({ page }) => {
    await addTask(page, 'Flash the bootloader');
    await addTask(page, 'Measure the current draw');
    await page.getByRole('checkbox', { name: 'Flash the bootloader' }).check();

    await page.reload();

    await expect(taskItems(page)).toHaveText(['Flash the bootloader', 'Measure the current draw']);
    await expect(page.getByRole('checkbox', { name: 'Flash the bootloader' })).toBeChecked();
    await expect(page.getByText('1 task left')).toBeVisible();
  });

  test('starts empty if the saved data is broken', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('pw-demo-tasks', '{not json'));
    await page.reload();

    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    // ...and still works.
    await addTask(page, 'Still works');
    await expect(taskItems(page)).toHaveText(['Still works']);
  });
});
