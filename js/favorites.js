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

export async function createFavorite(itemText, category = "Sonstiges", repeatWeekday = null) {
  const { family } = getState();
  const text = itemText.trim();
  if (!family || !text) return;
  const { error } = await supabase.from("shopping_favorites").insert({
    family_id: family.id,
    item_text: text,
    category: category.trim() || "Sonstiges",
    repeat_weekday: repeatWeekday === "" || repeatWeekday == null ? null : Number(repeatWeekday)
  });
  if (error) throw error;
  await loadFavorites(family.id);
}

export async function updateFavorite(id, changes) {
  const { family } = getState();
  if (!family) return;
  const payload = { ...changes, updated_at: new Date().toISOString() };
  if (Object.hasOwn(payload, "repeat_weekday")) {
    payload.repeat_weekday = payload.repeat_weekday === "" || payload.repeat_weekday == null ? null : Number(payload.repeat_weekday);
  }
  const { error } = await supabase.from("shopping_favorites").update(payload).eq("id", id);
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

export async function ensureRecurringFavoritesForDate(date) {
  const { favorites, items } = getState();
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return;
  const weekday = parsed.getDay();
  const recurring = favorites.filter((favorite) => favorite.repeat_weekday === weekday);
  for (const favorite of recurring) {
    const exists = items.some(
      (item) => item.shopping_date === date && item.item_text.trim().toLowerCase() === favorite.item_text.trim().toLowerCase()
    );
    if (!exists) await addShoppingItem(favorite.item_text);
  }
}