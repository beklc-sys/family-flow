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
    return Array.isArray(stored)
      ? stored.filter((favorite) => favorite?.id && favorite?.item_text)
      : [];
  } catch {
    return [];
  }
}

function sortFavorites(favorites) {
  return [...favorites].sort((a, b) =>
    a.item_text.localeCompare(b.item_text, "de", { sensitivity: "base" })
  );
}

function mergeFavorites(...collections) {
  const mergedByName = new Map();

  for (const collection of collections) {
    for (const favorite of collection || []) {
      const key = normalizeName(favorite.item_text);
      if (!key) continue;
      const existing = mergedByName.get(key);
      if (!existing || (existing.local_only && !favorite.local_only)) {
        mergedByName.set(key, favorite);
      }
    }
  }

  return sortFavorites([...mergedByName.values()]);
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
  const merged = mergeFavorites(favorites);
  localStorage.setItem(localStorageKey(familyId), JSON.stringify(merged));
  setState({ favorites: merged });
}

export async function loadFavorites(familyId) {
  const localFavorites = readLocalFavorites(familyId);

  try {
    const { data, error } = await supabase
      .from("shopping_favorites")
      .select("id, family_id, item_text, sort_order, created_at")
      .eq("family_id", familyId)
      .order("item_text");

    if (error) throw error;
    saveFavoritesToState(familyId, mergeFavorites(localFavorites, data || []));
  } catch (error) {
    console.warn("Favoriten konnten nicht aus Supabase geladen werden.", error);
    saveFavoritesToState(familyId, localFavorites);
  }
}

export async function createFavorite(itemText) {
  const { family } = getState();
  const text = itemText.trim();
  if (!family || !text) return;

  const currentFavorites = mergeFavorites(
    readLocalFavorites(family.id),
    getState().favorites
  );

  const duplicate = currentFavorites.some(
    (favorite) => normalizeName(favorite.item_text) === normalizeName(text)
  );
  if (duplicate) throw new Error("Dieser Favorit ist bereits gespeichert.");

  const optimisticFavorite = createLocalFavorite(family.id, text);
  saveFavoritesToState(family.id, [...currentFavorites, optimisticFavorite]);

  try {
    const { data, error } = await supabase
      .from("shopping_favorites")
      .insert({ family_id: family.id, item_text: text, sort_order: 0 })
      .select("id, family_id, item_text, sort_order, created_at");

    if (error) throw error;

    const savedFavorite = Array.isArray(data) ? data[0] : null;
    if (savedFavorite) {
      const latest = readLocalFavorites(family.id).filter(
        (favorite) => favorite.id !== optimisticFavorite.id
      );
      saveFavoritesToState(family.id, [...latest, savedFavorite]);
    }
  } catch (error) {
    console.warn("Favorit wurde nur lokal gespeichert.", error);
  }
}

export async function deleteFavorite(id) {
  const { family } = getState();
  if (!family) return;

  const currentFavorites = mergeFavorites(
    readLocalFavorites(family.id),
    getState().favorites
  );
  const favorite = currentFavorites.find((entry) => entry.id === id);
  const remaining = currentFavorites.filter((entry) => entry.id !== id);

  saveFavoritesToState(family.id, remaining);

  if (!favorite || favorite.local_only) return;

  try {
    const { error } = await supabase
      .from("shopping_favorites")
      .delete()
      .eq("id", id);
    if (error) throw error;
  } catch (error) {
    console.warn("Favorit konnte in Supabase nicht gelöscht werden.", error);
  }
}

export async function addFavoriteToShoppingList(favorite) {
  await addShoppingItem(favorite.item_text);
}
