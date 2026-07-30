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
  const { family, selectedDate, online } = getState();
  const cleanText = text.trim();
  if (!cleanText || !family) return;

  const optimisticItem = {
    id: crypto.randomUUID(),
    family_id: family.id,
    item_text: cleanText,
    shopping_date: selectedDate,
    is_done: false,
    created_by: family.membership?.user_id || null,
    updated_by: family.membership?.user_id || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    pending: !online
  };

  if (!online) {
    upsertItem(optimisticItem);
    addPendingOperation({ type: "insert", item: optimisticItem });
    return;
  }

  const { data, error } = await supabase
    .from("shopping_items")
    .insert({
      family_id: family.id,
      item_text: cleanText,
      shopping_date: selectedDate,
      is_done: false,
      created_by: (await supabase.auth.getUser()).data.user.id,
      updated_by: (await supabase.auth.getUser()).data.user.id
    })
    .select()
    .single();

  if (error) throw error;
  upsertItem(data);
}

export async function updateShoppingItem(id, changes) {
  const { online } = getState();

  if (!online) {
    const current = getState().items.find((item) => item.id === id);
    if (!current) return;
    const next = { ...current, ...changes, updated_at: new Date().toISOString(), pending: true };
    upsertItem(next);
    addPendingOperation({ type: "update", id, changes });
    return;
  }

  const { data, error } = await supabase
    .from("shopping_items")
    .update(changes)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  upsertItem(data);
}

export async function deleteShoppingItem(id) {
  const { online } = getState();

  if (!online) {
    removeItemFromStore(id);
    addPendingOperation({ type: "delete", id });
    return;
  }

  const { error } = await supabase.from("shopping_items").delete().eq("id", id);
  if (error) throw error;
  removeItemFromStore(id);
}

export async function flushPendingOperations() {
  const pending = getPendingOperations();
  if (!pending.length || !navigator.onLine) return;

  setState({ syncing: true });
  const failed = [];

  for (const operation of pending) {
    try {
      if (operation.type === "insert") {
        const item = operation.item;
        const { data: userData } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from("shopping_items")
          .insert({
            id: item.id,
            family_id: item.family_id,
            item_text: item.item_text,
            shopping_date: item.shopping_date,
            is_done: item.is_done,
            created_by: userData.user.id,
            updated_by: userData.user.id
          })
          .select()
          .single();
        if (error) throw error;
        upsertItem(data);
      }

      if (operation.type === "update") {
        const { data, error } = await supabase
          .from("shopping_items")
          .update(operation.changes)
          .eq("id", operation.id)
          .select()
          .single();
        if (error) throw error;
        upsertItem(data);
      }

      if (operation.type === "delete") {
        const { error } = await supabase.from("shopping_items").delete().eq("id", operation.id);
        if (error) throw error;
      }
    } catch {
      failed.push(operation);
    }
  }

  replacePendingOperations(failed);
  setState({ syncing: false });
}
