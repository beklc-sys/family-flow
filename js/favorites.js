import { supabase } from "./supabase.js";
import { getState, setState } from "./store.js";
import { addShoppingItem } from "./shopping.js";

function localStorageKey(familyId) {
  return `family-flow-favorites:${familyId}`;
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("de-DE");
}

function readLocalFavorites(familyId) {
  try {
    const stored = JSON.parse(localStorage.getItem(localStorageKey(familyId)) || "[]");
    return Array.isArray(stored) ? stored.filter((favorite) => favorite?.id && favorite?.item_text) : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(familyId, favorites) {
  localStorage.setItem(localStorageKey(familyId), JSON.stringify(sortFavorites(favorites)));
}

function sortFavorites(favorites) {
  return [...favorites].sort((a, b) =>
    a.item_text.localeCompare(b.item_text, "de", { sensitivity: "base" })
  );
}

function mergeFavorites(remoteFavorites, localFavorites) {
  const mergedByName = new Map();

  for (const favorite of remoteFavorites || []) {
    mergedByName.set(normalizeName(favorite.item_text), favorite);
  }

  for (const favorite of localFavorites || []) {
    const key = normalizeName(favorite.item_text);
    if (!mergedByName.has(key)) mergedByName.set(key, favorite);
  }

  return sortFavorites([...mergedByName.values()]);
}

function isFavoritesBackendUnavailable(error) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return (
    error?.code === "PGRST205" ||
    message.includes("shopping_favorites") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

function createLocalFavorite(familyId, itemText) {
  return {
    id: crypto.randomUUID(),
    family_id: familyId,
    item_text: itemText,
    sort_order: 0,
    created_at: new Date().toISOString(),
    local_only: true
  };
}

function saveFavoritesToState(familyId, favorites) {
  const sorted = sortFavorites(favorites);
  writeLocalFavorites(familyId, sorted);
  setState({ favorites: sorted });
}

export async function loadFavorites(familyId) {
  const localFavorites = readLocalFavorites(familyId);
  const { data, error } = await supabase
    .from("shopping_favorites")
    .select("id, family_id, item_text, sort_order, created_at")
    .eq("family_id", familyId)
    .order("item_text");

  if (!error) {
    saveFavoritesToState(familyId, mergeFavorites(data || [], localFavorites));
    return;
  }

  if (!isFavoritesBackendUnavailable(error)) throw error;
  saveFavoritesToState(familyId, localFavorites);
}

export async function createFavorite(itemText) {
  const { family, favorites } = getState();
  const text = itemText.trim();
  if (!family || !text) return;

  const duplicate = favorites.some(
    (favorite) => normalizeName(favorite.item_text) === normalizeName(text)
  );
  if (duplicate) throw new Error("Dieser Favorit ist bereits gespeichert.");

  const optimisticFavorite = createLocalFavorite(family.id, text);
  saveFavoritesToState(family.id, [...favorites, optimisticFavorite]);

  const { data, error } = await supabase
    .from("shopping_favorites")
    .insert({ family_id: family.id, item_text: text, sort_order: 0 })
    .select("id, family_id, item_text, sort_order, created_at");

  if (!error) {
    const savedFavorite = Array.isArray(data) ? data[0] : null;
    const currentFavorites = getState().favorites.filter(
      (favorite) => favorite.id !== optimisticFavorite.id
    );
    saveFavoritesToState(
      family.id,
      savedFavorite ? [...currentFavorites, savedFavorite] : currentFavorites
    );
    return;
  }

  if (error.code === "23505") {
    const withoutOptimistic = getState().favorites.filter(
      (favorite) => favorite.id !== optimisticFavorite.id
    );
    saveFavoritesToState(family.id, withoutOptimistic);
    await loadFavorites(family.id);
    throw new Error("Dieser Favorit ist bereits gespeichert.");
  }

  if (!isFavoritesBackendUnavailable(error)) {
    const withoutOptimistic = getState().favorites.filter(
      (favorite) => favorite.id !== optimisticFavorite.id
    );
    saveFavoritesToState(family.id, withoutOptimistic);
    throw error;
  }
}

export async function deleteFavorite(id) {
  const { family, favorites } = getState();
  if (!family) return;

  const favorite = favorites.find((entry) => entry.id === id);
  const remaining = favorites.filter((entry) => entry.id !== id);
  saveFavoritesToState(family.id, remaining);

  if (!favorite || favorite.local_only) return;

  const { error } = await supabase.from("shopping_favorites").delete().eq("id", id);
  if (!error || isFavoritesBackendUnavailable(error)) return;

  saveFavoritesToState(family.id, [...remaining, favorite]);
  throw error;
}

export async function deleteAllFavorites() {
  const { family, favorites } = getState();
  if (!family || favorites.length === 0) return;

  const previous = [...favorites];
  saveFavoritesToState(family.id, []);

  const remoteIds = previous
    .filter((favorite) => !favorite.local_only && favorite.id)
    .map((favorite) => favorite.id);

  if (remoteIds.length === 0) return;

  const { error } = await supabase
    .from("shopping_favorites")
    .delete()
    .in("id", remoteIds);

  if (!error || isFavoritesBackendUnavailable(error)) return;

  saveFavoritesToState(family.id, previous);
  throw error;
}

export async function addFavoriteToShoppingList(favorite) {
  await addShoppingItem(favorite.item_text);
}