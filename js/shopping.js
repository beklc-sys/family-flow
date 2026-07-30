import { supabase } from "./supabase.js";
import {
  addPendingOperation,
  getPendingOperations,
  getState,
  removeItemFromStore,
  replacePendingOperations,
  setItems,
  setState,
  upsertItem
} from "./store.js";

let activeFlush = null;

export async function loadShoppingItems(familyId) {
  const { data, error } = await supabase
    .from("shopping_items")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  setItems(data || []);
}

export async function addShoppingItem(text) {
  const { family, selectedDate } = getState();
  const cleanText = text.trim();
  if (!cleanText || !family) return;

  const userId = family.membership?.user_id || null;
  const now = new Date().toISOString();
  const optimisticItem = {
    id: crypto.randomUUID(),
    family_id: family.id,
    item_text: cleanText,
    shopping_date: selectedDate,
    is_done: false,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
    completed_at: null,
    pending: true
  };

  if (hasRecentEquivalentItem(optimisticItem)) return;

  if (!navigator.onLine) {
    queueInsert(optimisticItem);
    return;
  }

  try {
    const currentUserId = await getCurrentUserId();
    const { data, error } = await supabase
      .from("shopping_items")
      .insert({
        id: optimisticItem.id,
        family_id: family.id,
        item_text: cleanText,
        shopping_date: selectedDate,
        is_done: false,
        created_by: currentUserId,
        updated_by: currentUserId
      })
      .select();

    if (error) throw error;
    const savedItem = data?.[0];
    if (savedItem) upsertItem(savedItem);
  } catch (error) {
    if (!navigator.onLine || isNetworkError(error)) {
      queueInsert(optimisticItem);
      setState({ online: false });
      return;
    }
    throw error;
  }
}

export async function updateShoppingItem(id, changes) {
  const current = getState().items.find((item) => item.id === id);
  if (!current) return;

  const optimistic = {
    ...current,
    ...changes,
    updated_at: new Date().toISOString(),
    pending: true
  };

  if (!navigator.onLine) {
    upsertItem(optimistic);
    queueUpdate(id, changes);
    return;
  }

  try {
    const { error } = await supabase
      .from("shopping_items")
      .update(changes)
      .eq("id", id);

    if (error) throw error;
    upsertItem({ ...optimistic, pending: false });
  } catch (error) {
    if (!navigator.onLine || isNetworkError(error)) {
      upsertItem(optimistic);
      queueUpdate(id, changes);
      setState({ online: false });
      return;
    }
    throw error;
  }
}

export async function deleteShoppingItem(id) {
  const current = getState().items.find((item) => item.id === id);
  if (!current) return;

  if (!navigator.onLine) {
    removeItemFromStore(id);
    queueDelete(id);
    return;
  }

  try {
    const { error } = await supabase.from("shopping_items").delete().eq("id", id);
    if (error) throw error;
    removeItemFromStore(id);
  } catch (error) {
    if (!navigator.onLine || isNetworkError(error)) {
      removeItemFromStore(id);
      queueDelete(id);
      setState({ online: false });
      return;
    }
    throw error;
  }
}

export async function flushPendingOperations() {
  if (activeFlush) return activeFlush;

  activeFlush = performFlush();
  try {
    return await activeFlush;
  } finally {
    activeFlush = null;
  }
}

async function performFlush() {
  const pending = normalizePendingOperations(getPendingOperations());
  replacePendingOperations(pending);

  if (!pending.length || !navigator.onLine) return true;

  setState({ syncing: true, online: true });
  const failed = [];

  try {
    const userId = await getCurrentUserId();

    for (let index = 0; index < pending.length; index += 1) {
      const operation = pending[index];

      try {
        if (operation.type === "insert") {
          const item = operation.item;
          const { data, error } = await supabase
            .from("shopping_items")
            .upsert({
              id: item.id,
              family_id: item.family_id,
              item_text: item.item_text,
              shopping_date: item.shopping_date,
              is_done: item.is_done,
              created_by: userId,
              updated_by: userId
            }, { onConflict: "id" })
            .select();

          if (error) throw error;
          const savedItem = data?.[0];
          if (savedItem) upsertItem(savedItem);
        } else if (operation.type === "update") {
          const { error } = await supabase
            .from("shopping_items")
            .update(operation.changes)
            .eq("id", operation.id);

          if (error) throw error;
          const current = getState().items.find((item) => item.id === operation.id);
          if (current) upsertItem({ ...current, ...operation.changes, pending: false });
        } else if (operation.type === "delete") {
          const { error } = await supabase
            .from("shopping_items")
            .delete()
            .eq("id", operation.id);

          if (error) throw error;
          removeItemFromStore(operation.id);
        }
      } catch (error) {
        failed.push(operation);
        if (!navigator.onLine || isNetworkError(error)) {
          failed.push(...pending.slice(index + 1));
          break;
        }
      }
    }

    replacePendingOperations(failed);
    return failed.length === 0;
  } finally {
    setState({ syncing: false, online: navigator.onLine });
  }
}

function queueInsert(item) {
  upsertItem(item);

  const operations = getPendingOperations();
  const duplicate = operations.some((operation) => (
    operation.type === "insert" && equivalentQueuedItems(operation.item, item)
  ));

  if (!duplicate) addPendingOperation({ type: "insert", item });
}

function queueUpdate(id, changes) {
  const operations = getPendingOperations();
  const insertIndex = operations.findIndex(
    (operation) => operation.type === "insert" && operation.item.id === id
  );

  if (insertIndex >= 0) {
    operations[insertIndex] = {
      ...operations[insertIndex],
      item: { ...operations[insertIndex].item, ...changes, pending: true }
    };
    replacePendingOperations(operations);
    return;
  }

  const updateIndex = operations.findIndex(
    (operation) => operation.type === "update" && operation.id === id
  );

  if (updateIndex >= 0) {
    operations[updateIndex] = {
      ...operations[updateIndex],
      changes: { ...operations[updateIndex].changes, ...changes }
    };
    replacePendingOperations(operations);
    return;
  }

  addPendingOperation({ type: "update", id, changes });
}

function queueDelete(id) {
  const operations = getPendingOperations();
  const hadPendingInsert = operations.some(
    (operation) => operation.type === "insert" && operation.item.id === id
  );

  const filtered = operations.filter((operation) => {
    if (operation.type === "insert") return operation.item.id !== id;
    return operation.id !== id;
  });

  if (!hadPendingInsert) filtered.push({ type: "delete", id });
  replacePendingOperations(filtered);
}

function normalizePendingOperations(operations) {
  const normalized = [];

  for (const operation of operations) {
    if (operation.type !== "insert") {
      normalized.push(operation);
      continue;
    }

    const duplicate = normalized.some((existing) => (
      existing.type === "insert" && equivalentQueuedItems(existing.item, operation.item)
    ));

    if (!duplicate) normalized.push(operation);
  }

  return normalized;
}

function hasRecentEquivalentItem(item) {
  return getState().items.some((existing) => equivalentQueuedItems(existing, item));
}

function equivalentQueuedItems(first, second) {
  if (!first || !second) return false;
  if (first.family_id !== second.family_id) return false;
  if (first.shopping_date !== second.shopping_date) return false;
  if (normalizeText(first.item_text) !== normalizeText(second.item_text)) return false;

  const firstTime = Date.parse(first.created_at || 0);
  const secondTime = Date.parse(second.created_at || 0);
  if (!Number.isFinite(firstTime) || !Number.isFinite(secondTime)) return first.id === second.id;

  return Math.abs(firstTime - secondTime) <= 5000;
}

function normalizeText(value) {
  return String(value || "").trim().toLocaleLowerCase("de-DE");
}

async function getCurrentUserId() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) throw error;
  if (!user) throw new Error("Anmeldung nicht verfügbar.");
  return user.id;
}

function isNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("offline")
  );
}
