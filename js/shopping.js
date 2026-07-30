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

  const serverItems = data || [];
  const pending = normalizePendingOperations(getPendingOperations());
  replacePendingOperations(pending);
  setItems(applyPendingOperations(serverItems, pending));
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

  queueInsert(optimisticItem);

  if (!navigator.onLine) {
    setState({ online: false });
    return;
  }

  await flushPendingOperations();
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

  upsertItem(optimistic);
  queueUpdate(id, changes);

  if (!navigator.onLine) {
    setState({ online: false });
    return;
  }

  await flushPendingOperations();
}

export async function deleteShoppingItem(id) {
  const current = getState().items.find((item) => item.id === id);
  if (!current) return;

  removeItemFromStore(id);
  queueDelete(id);

  if (!navigator.onLine) {
    setState({ online: false });
    return;
  }

  await flushPendingOperations();
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
  const initialPending = normalizePendingOperations(getPendingOperations());
  replacePendingOperations(initialPending);

  if (!initialPending.length) return true;
  if (!navigator.onLine) {
    setState({ online: false });
    return false;
  }

  setState({ syncing: true, online: true });

  try {
    const userId = await getCurrentUserId();

    while (navigator.onLine) {
      const currentPending = normalizePendingOperations(getPendingOperations());
      replacePendingOperations(currentPending);

      if (!currentPending.length) return true;

      const operation = currentPending[0];

      try {
        await executePendingOperation(operation, userId);
        removeProcessedOperation(operation);
      } catch (error) {
        if (isNetworkError(error) || !navigator.onLine) {
          setState({ online: false });
          return false;
        }

        console.error("Offline-Vorgang konnte nicht synchronisiert werden", operation, error);
        return false;
      }
    }

    return false;
  } finally {
    setState({ syncing: false, online: navigator.onLine });
  }
}

function removeProcessedOperation(processedOperation) {
  const current = normalizePendingOperations(getPendingOperations());
  const processedKey = operationKey(processedOperation);
  const index = current.findIndex((operation) => operationKey(operation) === processedKey);

  if (index >= 0) current.splice(index, 1);
  replacePendingOperations(current);
}

function operationKey(operation) {
  if (operation?.type === "insert") return `insert:${operation.item?.id || ""}`;
  return `${operation?.type || "unknown"}:${operation?.id || ""}`;
}

async function executePendingOperation(operation, userId) {
  if (operation.type === "insert") {
    await synchronizeInsert(operation.item, userId);
    return;
  }

  if (operation.type === "update") {
    await synchronizeUpdate(operation.id, operation.changes);
    return;
  }

  if (operation.type === "delete") {
    await synchronizeDelete(operation.id);
    return;
  }

  throw new Error(`Unbekannter Offline-Vorgang: ${operation.type}`);
}

async function synchronizeInsert(item, userId) {
  const { data: existing, error: lookupError } = await supabase
    .from("shopping_items")
    .select("*")
    .eq("id", item.id)
    .limit(1);

  if (lookupError) throw lookupError;

  if (existing?.[0]) {
    upsertItem({ ...existing[0], pending: false });
    return;
  }

  const { error: insertError } = await supabase
    .from("shopping_items")
    .insert({
      id: item.id,
      family_id: item.family_id,
      item_text: item.item_text,
      shopping_date: item.shopping_date,
      is_done: Boolean(item.is_done),
      created_by: userId,
      updated_by: userId
    });

  if (insertError) throw insertError;

  const { data: saved, error: savedError } = await supabase
    .from("shopping_items")
    .select("*")
    .eq("id", item.id)
    .limit(1);

  if (savedError) throw savedError;
  if (!saved?.[0]) throw new Error("Der Offline-Eintrag wurde vom Server nicht bestätigt.");

  upsertItem({ ...saved[0], pending: false });
}

async function synchronizeUpdate(id, changes) {
  const { error: updateError } = await supabase
    .from("shopping_items")
    .update(changes)
    .eq("id", id);

  if (updateError) throw updateError;

  const { data: saved, error: savedError } = await supabase
    .from("shopping_items")
    .select("*")
    .eq("id", id)
    .limit(1);

  if (savedError) throw savedError;

  if (saved?.[0]) {
    upsertItem({ ...saved[0], pending: false });
    return;
  }

  const stillPendingInsert = getPendingOperations().some(
    (operation) => operation.type === "insert" && operation.item.id === id
  );

  if (!stillPendingInsert) {
    throw new Error("Der geänderte Eintrag wurde auf dem Server nicht gefunden.");
  }
}

async function synchronizeDelete(id) {
  const { error: deleteError } = await supabase
    .from("shopping_items")
    .delete()
    .eq("id", id);

  if (deleteError) throw deleteError;

  const { data: remaining, error: lookupError } = await supabase
    .from("shopping_items")
    .select("id")
    .eq("id", id)
    .limit(1);

  if (lookupError) throw lookupError;
  if (remaining?.length) throw new Error("Der gelöschte Eintrag ist noch auf dem Server vorhanden.");

  removeItemFromStore(id);
}

function queueInsert(item) {
  upsertItem(item);

  const operations = getPendingOperations();
  const existingIndex = operations.findIndex(
    (operation) => operation.type === "insert" && operation.item.id === item.id
  );

  if (existingIndex >= 0) {
    operations[existingIndex] = { type: "insert", item };
    replacePendingOperations(normalizePendingOperations(operations));
    return;
  }

  addPendingOperation({ type: "insert", item });
  replacePendingOperations(normalizePendingOperations(getPendingOperations()));
}

function queueUpdate(id, changes) {
  const operations = getPendingOperations();
  const insertIndex = operations.findIndex(
    (operation) => operation.type === "insert" && operation.item.id === id
  );

  if (insertIndex >= 0) {
    operations[insertIndex] = {
      type: "insert",
      item: {
        ...operations[insertIndex].item,
        ...changes,
        updated_at: new Date().toISOString(),
        pending: true
      }
    };
    replacePendingOperations(normalizePendingOperations(operations));
    return;
  }

  const updateIndex = operations.findIndex(
    (operation) => operation.type === "update" && operation.id === id
  );

  if (updateIndex >= 0) {
    operations[updateIndex] = {
      type: "update",
      id,
      changes: { ...operations[updateIndex].changes, ...changes }
    };
    replacePendingOperations(normalizePendingOperations(operations));
    return;
  }

  operations.push({ type: "update", id, changes });
  replacePendingOperations(normalizePendingOperations(operations));
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
  replacePendingOperations(normalizePendingOperations(filtered));
}

function normalizePendingOperations(operations) {
  const normalized = [];

  for (const operation of Array.isArray(operations) ? operations : []) {
    if (!operation || !operation.type) continue;

    if (operation.type === "insert" && operation.item?.id) {
      const index = normalized.findIndex(
        (entry) => entry.type === "insert" && entry.item.id === operation.item.id
      );
      if (index >= 0) normalized[index] = operation;
      else normalized.push(operation);
      continue;
    }

    if (operation.type === "update" && operation.id) {
      const insertIndex = normalized.findIndex(
        (entry) => entry.type === "insert" && entry.item.id === operation.id
      );
      if (insertIndex >= 0) {
        normalized[insertIndex] = {
          type: "insert",
          item: {
            ...normalized[insertIndex].item,
            ...operation.changes,
            pending: true
          }
        };
        continue;
      }

      const updateIndex = normalized.findIndex(
        (entry) => entry.type === "update" && entry.id === operation.id
      );
      if (updateIndex >= 0) {
        normalized[updateIndex] = {
          type: "update",
          id: operation.id,
          changes: {
            ...normalized[updateIndex].changes,
            ...operation.changes
          }
        };
      } else {
        normalized.push(operation);
      }
      continue;
    }

    if (operation.type === "delete" && operation.id) {
      const hadInsert = normalized.some(
        (entry) => entry.type === "insert" && entry.item.id === operation.id
      );
      const withoutItem = normalized.filter((entry) => {
        if (entry.type === "insert") return entry.item.id !== operation.id;
        return entry.id !== operation.id;
      });
      normalized.splice(0, normalized.length, ...withoutItem);
      if (!hadInsert) normalized.push(operation);
    }
  }

  return normalized;
}

function applyPendingOperations(serverItems, operations) {
  const itemsById = new Map((serverItems || []).map((item) => [item.id, item]));

  for (const operation of operations) {
    if (operation.type === "insert") {
      itemsById.set(operation.item.id, { ...operation.item, pending: true });
      continue;
    }

    if (operation.type === "update") {
      const current = itemsById.get(operation.id);
      if (current) {
        itemsById.set(operation.id, {
          ...current,
          ...operation.changes,
          pending: true
        });
      }
      continue;
    }

    if (operation.type === "delete") {
      itemsById.delete(operation.id);
    }
  }

  return [...itemsById.values()];
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
    message.includes("offline") ||
    message.includes("timeout")
  );
}
