import { getState, itemsForSelectedDate, setState, subscribe } from "./store.js";

const $ = (selector) => document.querySelector(selector);
const selectedFavoriteIds = new Set();

export const elements = {
  loadingView: $("#loading-view"), welcomeView: $("#welcome-view"), shoppingView: $("#shopping-view"), connectionStatus: $("#connection-status"), shareButton: $("#share-family-button"), createForm: $("#create-family-form"), joinForm: $("#join-family-form"), creatorName: $("#creator-name"), joinName: $("#join-name"), inviteToken: $("#invite-token"), listDate: $("#list-date"), dateDisplayButton: $("#date-display-button"), addForm: $("#add-item-form"), newItemText: $("#new-item-text"), openFavoritesButton: $("#open-favorites-button"), shoppingOverview: $("#shopping-overview"), shoppingDateOverview: $("#shopping-date-overview"), overviewCount: $("#overview-count"), emptyOverview: $("#empty-overview"), openItems: $("#open-items"), doneItems: $("#done-items"), openCount: $("#open-count"), doneCount: $("#done-count"), emptyOpenState: $("#empty-open-state"), doneSection: $("#done-section"), deleteDoneButton: $("#delete-done-button"), favoriteSearch: $("#favorite-search"), favoriteSelectionList: $("#favorite-selection-list"), emptyFavorites: $("#empty-favorites"), addSelectedFavoritesButton: $("#add-selected-favorites-button"), favoritesDialog: $("#favorites-dialog"), closeFavoritesButton: $("#close-favorites-button"), favoriteForm: $("#favorite-form"), favoriteText: $("#favorite-text"), shareDialog: $("#share-dialog"), inviteLink: $("#invite-link"), copyInviteButton: $("#copy-invite-button"), qrCode: $("#qr-code"), editDialog: $("#edit-dialog"), editForm: $("#edit-item-form"), editItemId: $("#edit-item-id"), editItemText: $("#edit-item-text"), deleteItemButton: $("#delete-item-button"), saveAsFavoriteButton: $("#save-as-favorite-button"), toast: $("#toast")
};

let currentHandlers = {};
export function startRendering(handlers) {
  currentHandlers = handlers;
  subscribe((state) => render(state));
}

function render(state) {
  elements.loadingView.classList.toggle("hidden", !state.loading);
  elements.welcomeView.classList.toggle("hidden", state.loading || Boolean(state.family));
  elements.shoppingView.classList.toggle("hidden", state.loading || !state.family);
  elements.shareButton.classList.toggle("hidden", !state.family);
  elements.listDate.value = state.selectedDate;
  elements.dateDisplayButton.textContent = `📅 ${formatFullDate(state.selectedDate)}`;
  renderConnectionStatus(state);
  if (state.family) {
    renderShoppingOverview(state);
    renderFavorites(state);
    renderItems();
  }
}

function renderConnectionStatus(state) {
  const status = elements.connectionStatus;
  status.className = "status-pill";
  if (state.error) { status.textContent = state.error; status.classList.add("error"); }
  else if (!state.online) { status.textContent = "Offline – Änderungen werden später synchronisiert"; status.classList.add("offline"); }
  else if (state.syncing) status.textContent = "Wird synchronisiert …";
  else { status.textContent = "Live verbunden"; status.classList.add("online"); }
}

function renderShoppingOverview(state) {
  const openByDate = new Map();
  state.items.forEach((item) => { if (!item.is_done && item.shopping_date) openByDate.set(item.shopping_date, (openByDate.get(item.shopping_date) || 0) + 1); });
  const dates = [...openByDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  elements.shoppingDateOverview.replaceChildren(...dates.map(([date, count]) => createDateButton(date, count, state.selectedDate)));
  elements.overviewCount.textContent = String(dates.length);
  elements.shoppingDateOverview.classList.toggle("hidden", !dates.length);
  elements.emptyOverview.classList.toggle("hidden", Boolean(dates.length));
}

function createDateButton(date, count, selectedDate) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `date-overview-button${date === selectedDate ? " selected" : ""}`;
  button.innerHTML = `<span class="date-overview-label">${formatOverviewDate(date)}</span><span class="date-overview-count">${count} offen</span>`;
  button.addEventListener("click", () => currentHandlers.onSelectDate?.(date));
  return button;
}

function renderFavorites(state) {
  const query = elements.favoriteSearch.value.trim().toLowerCase();
  const favorites = state.favorites.filter((favorite) => !query || favorite.item_text.toLowerCase().includes(query));

  const rows = favorites.map((favorite) => {
    const label = document.createElement("label");
    label.className = "favorite-select-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedFavoriteIds.has(favorite.id);
    checkbox.setAttribute("aria-label", `${favorite.item_text} auswählen`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedFavoriteIds.add(favorite.id);
      else selectedFavoriteIds.delete(favorite.id);
      updateSelectedButton();
    });

    const name = document.createElement("span");
    name.className = "favorite-select-name";
    name.textContent = favorite.item_text;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "favorite-delete-mini";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${favorite.item_text} löschen`);
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      currentHandlers.onDeleteFavorite?.(favorite);
    });

    label.append(checkbox, name, remove);
    return label;
  });

  elements.favoriteSelectionList.replaceChildren(...rows);
  elements.emptyFavorites.classList.toggle("hidden", state.favorites.length > 0);
  updateSelectedButton();
}

function updateSelectedButton() {
  const count = selectedFavoriteIds.size;
  elements.addSelectedFavoritesButton.disabled = count === 0;
  elements.addSelectedFavoritesButton.textContent = count === 0
    ? "Ausgewählte hinzufügen"
    : `${count} ${count === 1 ? "Favorit" : "Favoriten"} hinzufügen`;
}

export function getSelectedFavorites() {
  const favoritesById = new Map(getState().favorites.map((favorite) => [favorite.id, favorite]));
  return [...selectedFavoriteIds].map((id) => favoritesById.get(id)).filter(Boolean);
}

export function clearSelectedFavorites() {
  selectedFavoriteIds.clear();
  updateSelectedButton();
  setState({ favorites: [...getState().favorites] });
}

function renderItems() {
  const items = itemsForSelectedDate();
  const open = items.filter((item) => !item.is_done); const done = items.filter((item) => item.is_done);
  elements.openItems.replaceChildren(...open.map(createItem)); elements.doneItems.replaceChildren(...done.map(createItem));
  elements.openCount.textContent = String(open.length); elements.doneCount.textContent = String(done.length);
  elements.emptyOpenState.classList.toggle("hidden", open.length > 0); elements.doneSection.classList.toggle("hidden", done.length === 0);
}

function createItem(item) {
  const li = document.createElement("li"); li.className = "shopping-item";
  const check = document.createElement("button"); check.type = "button"; check.className = `check-button${item.is_done ? " checked" : ""}`; check.textContent = "✓"; check.addEventListener("click", () => currentHandlers.onToggle?.(item));
  const text = document.createElement("span"); text.className = "item-text"; text.textContent = item.item_text;
  const menu = document.createElement("button"); menu.type = "button"; menu.className = "item-menu"; menu.textContent = "•••"; menu.addEventListener("click", () => openEditDialog(item));
  li.append(check, text, menu); return li;
}

function openEditDialog(item) { elements.editItemId.value = item.id; elements.editItemText.value = item.item_text; elements.editDialog.showModal(); }
export function closeEditDialog() { elements.editDialog.close(); }
export function openFavoritesDialog() { selectedFavoriteIds.clear(); elements.favoriteSearch.value = ""; resetFavoriteForm(); elements.favoritesDialog.showModal(); setState({ favorites: [...getState().favorites] }); }
export function closeFavoritesDialog() { elements.favoritesDialog.close(); }
export function resetFavoriteForm() { elements.favoriteText.value = ""; }

export function getInviteTokenFromUrl() { return new URL(location.href).searchParams.get("invite") || ""; }
export function prepareInviteJoin(token) { if (token) elements.inviteToken.value = token; }
export function showShareDialog() { const family = getState().family; if (!family?.invite_token) return; const url = new URL(location.href); url.search = ""; url.searchParams.set("invite", family.invite_token); elements.inviteLink.value = url; elements.qrCode.replaceChildren(); if (window.QRCode) new window.QRCode(elements.qrCode, { text: url.toString(), width: 220, height: 220 }); elements.shareDialog.showModal(); }
export async function copyInviteLink() { await navigator.clipboard.writeText(elements.inviteLink.value); showToast("Einladungslink kopiert"); }
export function setSelectedDate(date) { setState({ selectedDate: date }); }

function formatFullDate(date) { const parsed = new Date(`${date}T12:00:00`); return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed); }
function formatOverviewDate(date) { const parsed = new Date(`${date}T12:00:00`); const today = new Date(); today.setHours(12,0,0,0); const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1); if (parsed.toDateString() === today.toDateString()) return "Heute"; if (parsed.toDateString() === tomorrow.toDateString()) return "Morgen"; return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }).format(parsed); }
let toastTimer; export function showToast(message) { clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.classList.remove("hidden"); toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 2800); }
export function friendlyError(error) { return error?.message || String(error || "Unbekannter Fehler"); }