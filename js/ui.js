import { getState, itemsForSelectedDate, setState, subscribe } from "./store.js";

const $ = (selector) => document.querySelector(selector);

export const elements = {
  loadingView: $("#loading-view"),
  welcomeView: $("#welcome-view"),
  shoppingView: $("#shopping-view"),
  connectionStatus: $("#connection-status"),
  shareButton: $("#share-family-button"),
  createForm: $("#create-family-form"),
  joinForm: $("#join-family-form"),
  creatorName: $("#creator-name"),
  joinName: $("#join-name"),
  inviteToken: $("#invite-token"),
  listDate: $("#list-date"),
  addForm: $("#add-item-form"),
  newItemText: $("#new-item-text"),
  shoppingOverview: $("#shopping-overview"),
  shoppingDateOverview: $("#shopping-date-overview"),
  overviewCount: $("#overview-count"),
  emptyOverview: $("#empty-overview"),
  openItems: $("#open-items"),
  doneItems: $("#done-items"),
  openCount: $("#open-count"),
  doneCount: $("#done-count"),
  emptyOpenState: $("#empty-open-state"),
  doneSection: $("#done-section"),
  deleteDoneButton: $("#delete-done-button"),
  shareDialog: $("#share-dialog"),
  inviteLink: $("#invite-link"),
  copyInviteButton: $("#copy-invite-button"),
  qrCode: $("#qr-code"),
  editDialog: $("#edit-dialog"),
  editForm: $("#edit-item-form"),
  editItemId: $("#edit-item-id"),
  editItemText: $("#edit-item-text"),
  deleteItemButton: $("#delete-item-button"),
  toast: $("#toast")
};

export function startRendering(handlers) {
  subscribe((state) => render(state, handlers));
}

function render(state, handlers) {
  elements.loadingView.classList.toggle("hidden", !state.loading);
  elements.welcomeView.classList.toggle("hidden", state.loading || Boolean(state.family));
  elements.shoppingView.classList.toggle("hidden", state.loading || !state.family);
  elements.shareButton.classList.toggle("hidden", !state.family);
  elements.listDate.value = state.selectedDate;

  renderConnectionStatus(state);
  if (state.family) {
    renderShoppingOverview(state);
    renderItems(handlers);
  }
}

function renderConnectionStatus(state) {
  const status = elements.connectionStatus;
  status.className = "status-pill";

  if (state.error) {
    status.textContent = state.error;
    status.classList.add("error");
  } else if (!state.online) {
    status.textContent = "Offline – Änderungen werden später synchronisiert";
    status.classList.add("offline");
  } else if (state.syncing) {
    status.textContent = "Wird synchronisiert …";
  } else {
    status.textContent = "Live verbunden";
    status.classList.add("online");
  }
}

function renderShoppingOverview(state) {
  const openByDate = new Map();

  for (const item of state.items) {
    if (item.is_done || !item.shopping_date) continue;
    openByDate.set(item.shopping_date, (openByDate.get(item.shopping_date) || 0) + 1);
  }

  const dates = [...openByDate.entries()].sort(([firstDate], [secondDate]) => firstDate.localeCompare(secondDate));
  const buttons = dates.map(([date, count]) => createDateOverviewButton(date, count, state.selectedDate));

  elements.shoppingDateOverview.replaceChildren(...buttons);
  elements.overviewCount.textContent = String(dates.length);
  elements.shoppingDateOverview.classList.toggle("hidden", dates.length === 0);
  elements.emptyOverview.classList.toggle("hidden", dates.length > 0);
}

function createDateOverviewButton(date, count, selectedDate) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `date-overview-button${date === selectedDate ? " selected" : ""}`;
  button.setAttribute("aria-label", `${formatOverviewDate(date)}, ${count} offene ${count === 1 ? "Sache" : "Sachen"}`);

  const dateLabel = document.createElement("span");
  dateLabel.className = "date-overview-label";
  dateLabel.textContent = formatOverviewDate(date);

  const countLabel = document.createElement("span");
  countLabel.className = "date-overview-count";
  countLabel.textContent = `${count} offen`;

  button.append(dateLabel, countLabel);
  button.addEventListener("click", () => {
    setSelectedDate(date);
    elements.shoppingOverview.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  return button;
}

function formatOverviewDate(date) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (parsed.toDateString() === today.toDateString()) return "Heute";
  if (parsed.toDateString() === tomorrow.toDateString()) return "Morgen";

  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  }).format(parsed);
}

function renderItems(handlers) {
  const items = itemsForSelectedDate();
  const open = items.filter((item) => !item.is_done);
  const done = items.filter((item) => item.is_done);

  elements.openItems.replaceChildren(...open.map((item) => createItem(item, handlers)));
  elements.doneItems.replaceChildren(...done.map((item) => createItem(item, handlers)));
  elements.openCount.textContent = String(open.length);
  elements.doneCount.textContent = String(done.length);
  elements.emptyOpenState.classList.toggle("hidden", open.length > 0);
  elements.doneSection.classList.toggle("hidden", done.length === 0);
  elements.deleteDoneButton.classList.toggle("hidden", done.length === 0);
}

function createItem(item, handlers) {
  const li = document.createElement("li");
  li.className = "shopping-item";
  if (item.pending) li.title = "Noch nicht synchronisiert";

  const check = document.createElement("button");
  check.type = "button";
  check.className = `check-button${item.is_done ? " checked" : ""}`;
  check.textContent = "✓";
  check.setAttribute("aria-label", item.is_done ? `${item.item_text} wieder öffnen` : `${item.item_text} als gekauft markieren`);
  check.addEventListener("click", () => handlers.onToggle(item));

  const text = document.createElement("span");
  text.className = "item-text";
  text.textContent = item.item_text;

  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "item-menu";
  menu.textContent = "•••";
  menu.setAttribute("aria-label", `${item.item_text} bearbeiten`);
  menu.addEventListener("click", () => openEditDialog(item));

  li.append(check, text, menu);
  return li;
}

export function getInviteTokenFromUrl() {
  return new URL(window.location.href).searchParams.get("invite") || "";
}

export function prepareInviteJoin(token) {
  if (!token) return;
  elements.inviteToken.value = token;
  elements.joinName.focus();
}

export function showShareDialog() {
  const family = getState().family;
  if (!family?.invite_token) return;

  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("invite", family.invite_token);
  elements.inviteLink.value = url.toString();
  elements.qrCode.replaceChildren();

  if (window.QRCode) {
    new window.QRCode(elements.qrCode, {
      text: url.toString(),
      width: 220,
      height: 220,
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } else {
    elements.qrCode.textContent = "QR-Code konnte nicht geladen werden. Bitte den Link kopieren.";
  }

  elements.shareDialog.showModal();
}

export async function copyInviteLink() {
  try {
    await navigator.clipboard.writeText(elements.inviteLink.value);
    showToast("Einladungslink kopiert");
  } catch {
    elements.inviteLink.select();
    document.execCommand("copy");
    showToast("Einladungslink kopiert");
  }
}

function openEditDialog(item) {
  elements.editItemId.value = item.id;
  elements.editItemText.value = item.item_text;
  elements.editDialog.showModal();
  elements.editItemText.focus();
}

export function closeEditDialog() {
  elements.editDialog.close();
}

export function setSelectedDate(date) {
  setState({ selectedDate: date });
}

let toastTimer;
export function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 2800);
}

export function friendlyError(error) {
  const message = error?.message || String(error || "Unbekannter Fehler");
  if (message.includes("already belongs") || message.includes("bereits zu einer Familie")) return "Dieses Gerät gehört bereits zu einer Familie.";
  if (message.includes("invalid") || message.includes("ungültig")) return "Der Einladungslink ist ungültig.";
  if (message.includes("already has two") || message.includes("bereits zwei")) return "Diese Familie hat bereits zwei Zugänge.";
  return message;
}