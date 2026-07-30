import { supabase } from "./supabase.js";
import { getState, setState } from "./store.js";
import { addShoppingItem } from "./shopping.js";

function localStorageKey(familyId) {
  return `family-flow-favorites:${familyId}`;
}

function readLocalFavorites(familyId) {
  try {
    const stored = JSON.parse(localStorage.getItem(localStorageKey(familyId)) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(familyId, favorites) {
  localStorage.setItem(localStorageKey(familyId), JSON.stringify(favorites));
}

function sortFavorites(favorites) {
  return [...favorites].sort((a, b) =>
    (a.sort_order || 0) - (b.sort_order || 0) ||
    a.item_text.localeCompare(b.item_text, "de")
  );
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

function createLocalFavorite(familyId, itemText, sortOrder = 0) {
  return {
    id: crypto.randomUUID(),
    family_id: familyId,
    item_text: itemText,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
    local_only: true
  };
}

export async function loadFavorites(familyId) {
  const { data, error } = await supabase
    .from("shopping_favorites")
    .select("id, family_id, item_text, sort_order, created_at")
    .eq("family_id", familyId)
    .order("sort_order")
    .order("item_text");

  if (!error) {
    setState({ favorites: sortFavorites(data || []) });
    return;
  }

  if (!isFavoritesBackendUnavailable(error)) throw error;
  setState({ favorites: sortFavorites(readLocalFavorites(familyId)) });
}

export async function ensureDefaultFavorites() {
  const { family, favorites } = getState();
  if (!family || favorites.length > 0) return;

  const defaults = [
    { family_id: family.id, item_text: "Äpfel", sort_order: 0 },
    { family_id: family.id, item_text: "Bananen", sort_order: 1 },
    { family_id: family.id, item_text: "Brot", sort_order: 2 }
  ];

  const { error } = await supabase.from("shopping_favorites").insert(defaults);

  if (!error || error.code === "23505") {
    await loadFavorites(family.id);
    return;
  }

  if (!isFavoritesBackendUnavailable(error)) throw error;

  const localDefaults = defaults.map((favorite) =>
    createLocalFavorite(family.id, favorite.item_text, favorite.sort_order)
  );
  writeLocalFavorites(family.id, localDefaults);
  setState({ favorites: localDefaults });
}

export async function createFavorite(itemText) {
  const { family, favorites } = getState();
  const text = itemText.trim();
  if (!family || !text) return;

  const duplicate = favorites.some(
    (favorite) => favorite.item_text.trim().toLowerCase() === text.toLowerCase()
  );
  if (duplicate) throw new Error("Dieser Favorit ist bereits gespeichert.");

  const { error } = await supabase.from("shopping_favorites").insert({
    family_id: family.id,
    item_text: text,
    sort_order: favorites.length
  });

  if (!error) {
    await loadFavorites(family.id);
    return;
  }

  if (!isFavoritesBackendUnavailable(error)) throw error;

  const updated = sortFavorites([
    ...favorites,
    createLocalFavorite(family.id, text, favorites.length)
  ]);
  writeLocalFavorites(family.id, updated);
  setState({ favorites: updated });
}

export async function deleteFavorite(id) {
  const { family, favorites } = getState();
  if (!family) return;

  const favorite = favorites.find((entry) => entry.id === id);
  if (favorite?.local_only) {
    const updated = favorites.filter((entry) => entry.id !== id);
    writeLocalFavorites(family.id, updated);
    setState({ favorites: updated });
    return;
  }

  const { error } = await supabase.from("shopping_favorites").delete().eq("id", id);

  if (!error) {
    await loadFavorites(family.id);
    return;
  }

  if (!isFavoritesBackendUnavailable(error)) throw error;

  const updated = favorites.filter((entry) => entry.id !== id);
  writeLocalFavorites(family.id, updated);
  setState({ favorites: updated });
}

export async function addFavoriteToShoppingList(favorite) {
  await addShoppingItem(favorite.item_text);
}
