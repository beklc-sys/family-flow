import { supabase } from "./supabase.js";
import { getState, setState } from "./store.js";
import { addShoppingItem } from "./shopping.js";

export async function loadFavorites(familyId) {
  const { data, error } = await supabase
    .from("shopping_favorites")
    .select("*")
    .eq("family_id", familyId)
    .order("category")
    .order("sort_order")
    .order("item_text");
  if (error) throw error;
  setState({ favorites: data || [] });
}

export async function ensureDefaultFavorites() {
  const { family, favorites } = getState();
  if (!family || favorites.length > 0) return;

  const defaults = [
    { family_id: family.id, item_text: "Äpfel", category: "Obst", sort_order: 0 },
    { family_id: family.id, item_text: "Bananen", category: "Obst", sort_order: 1 },
    { family_id: family.id, item_text: "Brot", category: "Backwaren", sort_order: 2 }
  ];

  const { error } = await supabase.from("shopping_favorites").insert(defaults);
  if (error && error.code !== "23505") throw error;
  await loadFavorites(family.id);
}

export async function createFavorite(itemText, category = "Sonstiges") {
  const { family } = getState();
  const text = itemText.trim();
  if (!family || !text) return;

  const { error } = await supabase.from("shopping_favorites").insert({
    family_id: family.id,
    item_text: text,
    category: category.trim() || "Sonstiges",
    repeat_weekday: null
  });
  if (error) throw error;
  await loadFavorites(family.id);
}

export async function deleteFavorite(id) {
  const { family } = getState();
  if (!family) return;
  const { error } = await supabase.from("shopping_favorites").delete().eq("id", id);
  if (error) throw error;
  await loadFavorites(family.id);
}

export async function addFavoriteToShoppingList(favorite) {
  await addShoppingItem(favorite.item_text);
}
