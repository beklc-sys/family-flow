import { getState, itemsForSelectedDate, setState, subscribe } from "./store.js";

const $ = (selector) => document.querySelector(selector);
export const elements = {
  loadingView: $("#loading-view"), welcomeView: $("#welcome-view"), shoppingView: $("#shopping-view"), connectionStatus: $("#connection-status"), shareButton: $("#share-family-button"), createForm: $("#create-family-form"), joinForm: $("#join-family-form"), creatorName: $("#creator-name"), joinName: $("#join-name"), inviteToken: $("#invite-token"), listDate: $("#list-date"), dateDisplayButton: $("#date-display-button"), addForm: $("#add-item-form"), newItemText: $("#new-item-text"), shoppingOverview: $("#shopping-overview"), shoppingDateOverview: $("#shopping-date-overview"), overviewCount: $("#overview-count"), emptyOverview: $("#empty-overview"), openItems: $("#open-items"), doneItems: $("#done-items"), openCount: $("#open-count"), doneCount: $("#done-count"), emptyOpenState: $("#empty-open-state"), doneSection: $("#done-section"), deleteDoneButton: $("#delete-done-button"), quickFavoriteForm: $("#quick-favorite-form"), quickFavoriteText: $("#quick-favorite-text"), favoriteSearch: $("#favorite-search"), favoriteChips: $("#favorite-chips"), emptyFavorites: $("#empty-favorites"), manageFavoritesButton: $("#manage-favorites-button"), favoritesDialog: $("#favorites-dialog"), closeFavoritesButton: $("#close-favorites-button"), favoriteForm: $("#favorite-form"), favoriteId: $("#favorite-id"), favoriteText: $("#favorite-text"), favoriteCategory: $("#favorite-category"), favoriteRepeat: $("#favorite-repeat"), favoriteManagerList: $("#favorite-manager-list"), shareDialog: $("#share-dialog"), inviteLink: $("#invite-link"), copyInviteButton: $("#copy-invite-button"), qrCode: $("#qr-code"), editDialog: $("#edit-dialog"), editForm: $("#edit-item-form"), editItemId: $("#edit-item-id"), editItemText: $("#edit-item-text"), deleteItemButton: $("#delete-item-button"), saveAsFavoriteButton: $("#save-as-favorite-button"), toast: $("#toast")
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
  const favorites = state.favorites.filter((favorite) => !query || favorite.item_text.toLowerCase().includes(query) || favorite.category.toLowerCase().includes(query));
  const grouped = new Map();
  favorites.forEach((favorite) => { const category = favorite.category || "Sonstiges"; if (!grouped.has(category)) grouped.set(category, []); grouped.get(category).push(favorite); });
  const nodes = [];
  for (const [category, entries] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, "de"))) {
    const group = document.createElement("div"); group.className = "favorite-group";
    const title = document.createElement("p"); title.className = "favorite-category-title"; title.textContent = category;
    const chips = document.createElement("div"); chips.className = "favorite-chip-row";
    entries.forEach((favorite) => { const button = document.createElement("button"); button.type = "button"; button.className = "favorite-chip"; button.textContent = `＋ ${favorite.item_text}`; button.addEventListener("click", () => currentHandlers.onAddFavorite?.(favorite)); chips.append(button); });
    group.append(title, chips); nodes.push(group);
  }
  elements.favoriteChips.replaceChildren(...nodes);
  elements.emptyFavorites.classList.toggle("hidden", state.favorites.length > 0);
  renderFavoriteManager(state.favorites);
}

function renderFavoriteManager(favorites) {
  elements.favoriteManagerList.replaceChildren(...favorites.map((favorite) => {
    const row = document.createElement("div"); row.className = "favorite-manager-row";
    const text = document.createElement("div"); text.innerHTML = `<strong>${favorite.item_text}</strong><small>${favorite.category}${favorite.repeat_weekday == null ? "" : ` · ${weekdayLabel(favorite.repeat_weekday)}`}</small>`;
    const actions = document.createElement("div"); actions.className = "manager-actions";
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "secondary-button compact-button"; edit.textContent = "Ändern"; edit.addEventListener("click", () => fillFavoriteForm(favorite));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger-button compact-button"; remove.textContent = "Löschen"; remove.addEventListener("click", () => currentHandlers.onDeleteFavorite?.(favorite));
    actions.append(edit, remove); row.append(text, actions); return row;
  }));
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
export function openFavoritesDialog() { resetFavoriteForm(); elements.favoritesDialog.showModal(); }
export function closeFavoritesDialog() { elements.favoritesDialog.close(); }
export function resetFavoriteForm() { elements.favoriteId.value = ""; elements.favoriteText.value = ""; elements.favoriteCategory.value = "Sonstiges"; elements.favoriteRepeat.value = ""; }
function fillFavoriteForm(favorite) { elements.favoriteId.value = favorite.id; elements.favoriteText.value = favorite.item_text; elements.favoriteCategory.value = favorite.category; elements.favoriteRepeat.value = favorite.repeat_weekday ?? ""; elements.favoriteText.focus(); }

export function getInviteTokenFromUrl() { return new URL(location.href).searchParams.get("invite") || ""; }
export function prepareInviteJoin(token) { if (token) elements.inviteToken.value = token; }
export function showShareDialog() { const family = getState().family; if (!family?.invite_token) return; const url = new URL(location.href); url.search = ""; url.searchParams.set("invite", family.invite_token); elements.inviteLink.value = url; elements.qrCode.replaceChildren(); if (window.QRCode) new window.QRCode(elements.qrCode, { text: url.toString(), width: 220, height: 220 }); elements.shareDialog.showModal(); }
export async function copyInviteLink() { await navigator.clipboard.writeText(elements.inviteLink.value); showToast("Einladungslink kopiert"); }
export function setSelectedDate(date) { setState({ selectedDate: date }); }

function formatFullDate(date) { const parsed = new Date(`${date}T12:00:00`); return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed); }
function formatOverviewDate(date) { const parsed = new Date(`${date}T12:00:00`); const today = new Date(); today.setHours(12,0,0,0); const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1); if (parsed.toDateString() === today.toDateString()) return "Heute"; if (parsed.toDateString() === tomorrow.toDateString()) return "Morgen"; return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }).format(parsed); }
function weekdayLabel(day) { return ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][day]; }
let toastTimer; export function showToast(message) { clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.classList.remove("hidden"); toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 2800); }
export function friendlyError(error) { return error?.message || String(error || "Unbekannter Fehler"); }