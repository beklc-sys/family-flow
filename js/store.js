import { CONFIG } from "./config.js";

const listeners = new Set();

const initialState = {
  family: null,
  items: [],
  selectedDate: new Date().toISOString().slice(0, 10),
  loading: true,
  online: navigator.onLine,
  syncing: false,
  error: null
};

let state = loadCachedState();

function loadCachedState() {
  try {
    const cached = JSON.parse(localStorage.getItem(CONFIG.cacheKey) || "null");
    return cached ? { ...initialState, ...cached, loading: true, online: navigator.onLine } : { ...initialState };
  } catch {
    return { ...initialState };
  }
}

function persist() {
  const snapshot = {
    family: state.family,
    items: state.items,
    selectedDate: state.selectedDate
  };
  localStorage.setItem(CONFIG.cacheKey, JSON.stringify(snapshot));
}

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((listener) => listener(state));
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function setItems(items) {
  const uniqueItems = Array.from(
    new Map((items || []).filter(Boolean).map((item) => [item.id, item])).values()
  );
  setState({ items: sortItems(uniqueItems) });
}

export function upsertItem(item) {
  if (!item?.id) return;
  const items = state.items.filter((existing) => existing.id !== item.id);
  items.push(item);
  setItems(items);
}

export function removeItemFromStore(id) {
  setItems(state.items.filter((item) => item.id !== id));
}

export function itemsForSelectedDate() {
  return state.items.filter((item) => item.shopping_date === state.selectedDate);
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.is_done !== b.is_done) return Number(a.is_done) - Number(b.is_done);
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

export function addPendingOperation(operation) {
  const operations = getPendingOperations();

  if (operation.type === "insert") {
    const item = operation.item;
    const createdAt = new Date(item.created_at || 0).getTime();
    const existingIndex = operations.findIndex((candidate) => {
      if (candidate.type !== "insert") return false;
      if (candidate.item?.id === item.id) return true;

      const candidateTime = new Date(candidate.item?.created_at || 0).getTime();
      return (
        candidate.item?.family_id === item.family_id &&
        candidate.item?.shopping_date === item.shopping_date &&
        candidate.item?.item_text === item.item_text &&
        Math.abs(candidateTime - createdAt) < 15000
      );
    });

    if (existingIndex >= 0) {
      operations[existingIndex] = operation;
    } else {
      operations.push(operation);
    }
  } else if (operation.type === "delete") {
    const alreadyQueued = operations.some(
      (candidate) => candidate.type === "delete" && candidate.id === operation.id
    );
    if (!alreadyQueued) operations.push(operation);
  } else {
    operations.push(operation);
  }

  replacePendingOperations(operations);
}

export function getPendingOperations() {
  try {
    const operations = JSON.parse(localStorage.getItem(CONFIG.pendingKey) || "[]");
    return Array.isArray(operations) ? operations : [];
  } catch {
    return [];
  }
}

export function replacePendingOperations(operations) {
  const unique = [];
  const seen = new Set();

  for (const operation of operations || []) {
    const key = operation.type === "insert"
      ? `insert:${operation.item?.id}`
      : `${operation.type}:${operation.id}`;

    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(operation);
  }

  localStorage.setItem(CONFIG.pendingKey, JSON.stringify(unique));
}