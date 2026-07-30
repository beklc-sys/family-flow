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
  setState({ items: sortItems(items) });
}

export function upsertItem(item) {
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
  operations.push(operation);
  localStorage.setItem(CONFIG.pendingKey, JSON.stringify(operations));
}

export function getPendingOperations() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG.pendingKey) || "[]");
  } catch {
    return [];
  }
}

export function replacePendingOperations(operations) {
  localStorage.setItem(CONFIG.pendingKey, JSON.stringify(operations));
}
