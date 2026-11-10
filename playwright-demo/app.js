// Task List: add, complete, filter, delete and clear tasks; the list is kept in localStorage.
// Every control has an accessible name, so the Playwright tests can find it by role and label
// the same way a person (or a screen reader) would, instead of relying on CSS classes.
(() => {
  'use strict';

  const STORAGE_KEY = 'pw-demo-tasks';
  const $ = (sel) => document.querySelector(sel);

  const form = $('#new-task');
  const input = $('#task-input');
  const error = $('#form-error');
  const list = $('#tasks');
  const empty = $('#empty');
  const count = $('#count');
  const clearDone = $('#clear-done');
  const chips = document.querySelectorAll('.chip');

  let tasks = load();
  let filter = 'all';

  // Storage can be missing or blocked (private windows, previews), so the app still works without it.
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter((t) => t && typeof t.text === 'string') : [];
    } catch {
      return [];
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch { /* not saved; fine */ }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function visible(task) {
    if (filter === 'active') return !task.done;
    if (filter === 'done') return task.done;
    return true;
  }

  function render() {
    list.replaceChildren();
    for (const task of tasks.filter(visible)) {
      const li = document.createElement('li');
      li.className = 'task' + (task.done ? ' done' : '');
      li.dataset.id = task.id;

      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = task.done;
      box.addEventListener('change', () => { task.done = box.checked; save(); render(); });
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = task.text; // textContent, never innerHTML: task text is user input
      label.append(box, text);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      // An icon rather than a "×" character, so the item's text is only the task itself.
      del.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      del.setAttribute('aria-label', 'Delete ' + task.text);
      del.addEventListener('click', () => { tasks = tasks.filter((t) => t !== task); save(); render(); });

      li.append(label, del);
      list.append(li);
    }

    const left = tasks.filter((t) => !t.done).length;
    count.textContent = left + (left === 1 ? ' task left' : ' tasks left');
    clearDone.disabled = !tasks.some((t) => t.done);

    const messages = { all: 'Nothing here yet.', active: 'No active tasks.', done: 'No finished tasks.' };
    empty.textContent = messages[filter];
    empty.hidden = list.children.length > 0;

    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === filter)));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      error.textContent = 'Type a task first.';
      input.focus();
      return;
    }
    error.textContent = '';
    tasks.push({ id: newId(), text, done: false });
    input.value = '';
    save();
    render();
    input.focus();
  });
  input.addEventListener('input', () => { error.textContent = ''; });

  chips.forEach((c) => c.addEventListener('click', () => { filter = c.dataset.filter; render(); }));
  clearDone.addEventListener('click', () => { tasks = tasks.filter((t) => !t.done); save(); render(); });

  render();
})();
