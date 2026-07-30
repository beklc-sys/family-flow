import { supabase } from "./supabase.js";
import { getState, setState } from "./store.js";
import { addShoppingItem } from "./shopping.js";

const LEGACY_DEFAULT_NAMES = new Set(["äpfel", "bananen", "brot"]);

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
    a.item_text.localeCompare(b.item_text, "de", { sensitivity: "base" })
  );
}

function containsOnlyLegacyDefaults(favorites) {
  if (favorites.length !== LEGACY_DEFAULT_NAMES.size) return false;
  const names = new Set(
    favorites.map((favorite) => favorite.item_text.trim().toLowerCase())
  );
  return [...LEGACY_DEFAULT_NAMES].every((name) => names.has(name));
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

async function removeLegacyDefaultsFromBackend(familyId, favorites) {
  if (!containsOnlyLegacyDefaults(favorites)) return favorites;

  const ids = favorites.map((favorite) => favorite.id).filter(Boolean);
  if (ids.length) {
    const { error } = await supabase
      .from("shopping_favorites")
      .delete()
      .in("id", ids);
    if (error) throw error;
  }

  return [];
}

export async function loadFavorites(familyId) {
  const { data, error } = await supabase
    .from("shopping_favorites")
    .select("id, family_id, item_text, sort_order, created_at")
    .eq("family_id", familyId)
    .order("item_text");

  if (!error) {
    const cleaned = await removeLegacyDefaultsFromBackend(familyId, data || []);
    setState({ favorites: sortFavorites(cleaned) });
    return;
  }

  if (!isFavoritesBackendUnavailable(error)) throw error;

  const localFavorites = readLocalFavorites(familyId);
  const cleaned = containsOnlyLegacyDefaults(localFavorites) ? [] : localFavorites;
  if (cleaned.length !== localFavorites.length) writeLocalFavorites(familyId, cleaned);
  setState({ favorites: sortFavorites(cleaned) });
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
    sort_order: 0
  });

  if (!error) {
    await loadFavorites(family.id);
    return;
  }

  if (!isFavoritesBackendUnavailable(error)) throw error;

  const updated = sortFavorites([
    ...favorites,
    createLocalFavorite(family.id, text)
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
    setState({ favorites: sortFavorites(updated) });
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
  setState({ favorites: sortFavorites(updated) });
}

export async function addFavoriteToShoppingList(favorite) {
  await addShoppingItem(favorite.item_text);
}
