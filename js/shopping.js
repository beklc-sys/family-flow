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
  const optimisticItem = {
    id: crypto.randomUUID(),
    family_id: family.id,
    item_text: cleanText,
    shopping_date: selectedDate,
    is_done: false,
    created_by: userId,
    updated_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    pending: true
  };

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
      .select()
      .single();

    if (error) throw error;
    upsertItem(data);
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
    const { data, error } = await supabase
      .from("shopping_items")
      .update(changes)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    upsertItem(data);
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
  const pending = getPendingOperations();
  if (!pending.length || !navigator.onLine) return true;

  setState({ syncing: true, online: true });
  const failed = [];

  try {
    const userId = await getCurrentUserId();

    for (const operation of pending) {
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
            })
            .select()
            .single();

          if (error) throw error;
          upsertItem(data);
        } else if (operation.type === "update") {
          const { data, error } = await supabase
            .from("shopping_items")
            .update(operation.changes)
            .eq("id", operation.id)
            .select()
            .maybeSingle();

          if (error) throw error;
          if (data) upsertItem(data);
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
          const remaining = pending.slice(pending.indexOf(operation) + 1);
          failed.push(...remaining);
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
  addPendingOperation({ type: "insert", item });
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
