export function updateBottomSheet(title, sub, target = "student") {
  const sheet = document.getElementById(`${target}Sheet`);
  if (!sheet) return;
  const h3 = sheet.querySelector("h3");
  const p = sheet.querySelector("p");
  if (h3) h3.innerText = title;
  if (p) p.innerText = sub;
}

export function updateRideDetails(target, details) {
  const containerId = target === "rider" ? "riderSheetDetails" : "studentRideDetails";
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = details.map(d => `
    <div class="ride-detail"><span>${d.label}</span><strong>${d.value}</strong></div>
  `).join("");
}

// ===== BOTTOM SHEET DRAGGING =====
let startY = 0;
let currentY = 0;
let isDragging = false;  // only becomes true once user actually starts moving
let draggingSheet = null;

export function startDrag(e, sheetId) {
  draggingSheet = document.getElementById(sheetId);
  if (!draggingSheet) return;

  startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
  isDragging = false;
  draggingSheet.style.transition = 'none';

  document.addEventListener('mousemove', handleDrag, { passive: true });
  // passive: false so we can call preventDefault when it's a real drag
  document.addEventListener('touchmove', handleDrag, { passive: false });
  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchend', endDrag);
}

function handleDrag(e) {
  if (!draggingSheet) return;

  const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
  const deltaY = clientY - startY;

  const isMinimized = draggingSheet.classList.contains('minimized');

  // skip swipe directions that don't make sense
  if (isMinimized && deltaY > 0) return;  // already at the bottom, nowhere to go
  if (!isMinimized && deltaY < 0) return; // already expanded

  // wait until we have a proper drag (> 6px) before blocking scroll
  if (!isDragging) {
    if (Math.abs(deltaY) < 6) return;
    isDragging = true;
  }

  // confirmed drag — prevent native scroll from firing
  if (e.cancelable) e.preventDefault();

  draggingSheet.style.transform = `translateY(${deltaY}px)`;
  currentY = deltaY;
}

function endDrag() {
  if (!draggingSheet) return;

  draggingSheet.style.transition = '';
  const threshold = 80;

  if (Math.abs(currentY) > threshold) {
    const isMinimized = draggingSheet.classList.contains('minimized');
    if (isMinimized && currentY < -threshold) {
      draggingSheet.classList.remove('minimized');
      draggingSheet.classList.add('expanded');
    } else if (!isMinimized && currentY > threshold) {
      draggingSheet.classList.add('minimized');
      draggingSheet.classList.remove('expanded');
    }
  }

  draggingSheet.style.transform = '';
  draggingSheet = null;
  currentY = 0;
  isDragging = false;

  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('touchmove', handleDrag);
  document.removeEventListener('mouseup', endDrag);
  document.removeEventListener('touchend', endDrag);
}

// expose to html
window.startDrag = startDrag;

export function toggleControls(show, target = "student") {
  const el = document.getElementById(`${target}Controls`);
  if (el) el.style.display = show ? "flex" : "none";
}

// custom toast notifications
export function showToast(message, type = "info", duration = 3000) {
  const container = document.querySelector(".toast-container") ||
    (() => {
      const c = document.createElement("div");
      c.className = "toast-container";
      document.body.appendChild(c);
      return c;
    })();

  const icons = {
    success: "fa-check-circle",
    error: "fa-exclamation-circle",
    warning: "fa-exclamation-triangle",
    info: "fa-info-circle"
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", "alert");

  const iconEl = document.createElement("span");
  iconEl.className = `toast-icon ${type}`;
  iconEl.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i>`;

  const textEl = document.createElement("span");
  textEl.className = "toast-text";
  textEl.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close-btn";
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissToast(toast);
  });

  const progressBar = document.createElement("div");
  progressBar.className = "toast-progress";
  progressBar.style.setProperty("--toast-duration", `${duration}ms`);
  progressBar.style.animationDuration = `${duration}ms`;

  toast.appendChild(iconEl);
  toast.appendChild(textEl);
  toast.appendChild(closeBtn);
  toast.appendChild(progressBar);
  container.appendChild(toast);

  // swipe the toast away
  let swipeStartX = 0;
  let swiped = false;

  toast.addEventListener("pointerdown", (e) => {
    swipeStartX = e.clientX;
    swiped = false;
    toast.style.transition = "none";
  });

  toast.addEventListener("pointermove", (e) => {
    if (!swipeStartX) return;
    const deltaX = e.clientX - swipeStartX;
    if (Math.abs(deltaX) > 15) {
      swiped = true;
      toast.style.transform = `translateX(${deltaX}px)`;
      toast.style.opacity = Math.max(0, 1 - Math.abs(deltaX) / 200);
    }
  });

  toast.addEventListener("pointerup", (e) => {
    const deltaX = e.clientX - swipeStartX;
    toast.style.transition = "opacity 0.25s ease, transform 0.3s ease";
    swipeStartX = 0;
    if (swiped && Math.abs(deltaX) > 60) {
      dismissToast(toast);
    } else {
      toast.style.transform = "";
      toast.style.opacity = "";
    }
  });

  toast.addEventListener("pointerleave", () => {
    if (swipeStartX) {
      toast.style.transition = "opacity 0.25s ease, transform 0.3s ease";
      toast.style.transform = "";
      toast.style.opacity = "";
      swipeStartX = 0;
    }
  });

  const autoDismissTimer = setTimeout(() => {
    dismissToast(toast);
  }, duration);

  toast._dismissTimer = autoDismissTimer;

  function dismissToast(el) {
    if (el._dismissed) return;
    el._dismissed = true;
    clearTimeout(el._dismissTimer);
    el.classList.add("dismissing");
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 300);
  }
}

// put showToast on window so anyone can call it
window.showToast = showToast;

export function setButtonVisible(id, visible) {
  const btn = document.getElementById(id);
  if (btn) btn.classList.toggle("hidden", !visible);
}

export function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
}

// confirm dialogs — works with both callbacks and async/await
export function showConfirmDialog({ title, message, confirmText, cancelText, onConfirm, danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog-sheet">
        <div class="dialog-handle"></div>
        <div class="dialog-title">${title}</div>
        <div class="dialog-message">${message}</div>
        <div class="dialog-actions">
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="dialog-confirm">
            ${confirmText || "Confirm"}
          </button>
          <button class="btn btn-ghost" id="dialog-cancel">
            ${cancelText || "Cancel"}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#dialog-confirm").addEventListener("click", () => {
      overlay.remove();
      if (onConfirm) onConfirm();
      resolve(true);
    });

    const closeDialog = () => {
      overlay.remove();
      resolve(false);
    };

    overlay.querySelector("#dialog-cancel").addEventListener("click", closeDialog);
    overlay.addEventListener("click", e => { if (e.target === overlay) closeDialog(); });
  });
}

// prompt dialogs that return a promise
export function showPromptDialog({ title, message, placeholder = "", inputType = "text", confirmText = "Submit", cancelText = "Cancel" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog-sheet">
        <div class="dialog-handle"></div>
        <div class="dialog-title">${title}</div>
        <div class="dialog-message" style="margin-bottom: var(--space-sm);">${message}</div>
        <div class="input-group" style="margin-bottom: var(--space-md);">
          <input type="${inputType}" id="dialog-prompt-input" class="input-field" placeholder="${placeholder}" autocomplete="off" style="color: var(--color-text-primary) !important;">
        </div>
        <div class="dialog-actions">
          <button class="btn btn-primary" id="dialog-confirm">
            ${confirmText}
          </button>
          <button class="btn btn-ghost" id="dialog-cancel">
            ${cancelText}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector("#dialog-prompt-input");
    setTimeout(() => input.focus(), 50);

    overlay.querySelector("#dialog-confirm").addEventListener("click", () => {
      const val = input.value;
      overlay.remove();
      resolve(val);
    });

    const closeDialog = () => {
      overlay.remove();
      resolve(null);
    };

    overlay.querySelector("#dialog-cancel").addEventListener("click", closeDialog);
    overlay.addEventListener("click", e => { if (e.target === overlay) closeDialog(); });
  });
}

// make these globally accessible
window.showConfirmDialog = showConfirmDialog;
window.showPromptDialog = showPromptDialog;

// quick balance number flip animation
export function animateBalance(elementId, newValue) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.style.transform = "translateY(-4px)";
  element.style.opacity = "0";
  element.style.transition = "all 0.15s ease";
  setTimeout(() => {
    element.textContent = newValue;
    element.style.transform = "translateY(0)";
    element.style.opacity = "1";
  }, 150);
}

// greeting based on time of day
export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning ☀️";
  if (hour < 17) return "Good afternoon 🌤️";
  return "Good evening 🌙";
}

// splash screen logic
let _splashDismissed = false;
let _splashReady = false; // flips true after minimum show time
let _authReady = false;   // flips true after auth resolves

function _tryDismissSplash() {
  if (_splashDismissed || !_splashReady || !_authReady) return;
  _splashDismissed = true;
  const splash = document.getElementById("splash");
  if (splash) {
    splash.style.opacity = "0";
    splash.style.pointerEvents = "none";
    setTimeout(() => splash.remove(), 400);
  }
}

// call this once auth finishes checking login state
export function dismissSplash() {
  _authReady = true;
  _tryDismissSplash();
}

export function initSplashScreen() {
  // minimum 1 second so the splash doesn't just flash
  setTimeout(() => {
    _splashReady = true;
    _tryDismissSplash();
  }, 1000);
}

// custom select/dropdown that opens as a bottom sheet
export function makeCustomSelect(selectId, title) {
  const select = document.getElementById(selectId);
  if (!select) return;
  if (select.dataset.customSelectInitialized) return;
  select.dataset.customSelectInitialized = "true";

  // hide the native select, we're replacing it
  select.style.setProperty("display", "none", "important");

  // the visible trigger button
  const trigger = document.createElement("div");
  trigger.className = "input-field custom-select-trigger";
  trigger.id = `${selectId}-trigger`;
  trigger.style.cursor = "pointer";
  trigger.style.display = "flex";
  trigger.style.alignItems = "center";
  trigger.style.justifyContent = "space-between";
  
  const textSpan = document.createElement("span");
  textSpan.className = "custom-select-trigger-text";
  trigger.appendChild(textSpan);

  const caret = document.createElement("i");
  caret.className = "fas fa-chevron-down custom-select-caret";
  caret.style.color = "var(--color-accent)";
  caret.style.transition = "transform 0.2s ease";
  trigger.appendChild(caret);

  // put trigger right after the hidden select
  select.parentNode.insertBefore(trigger, select.nextSibling);

  // keep trigger text in sync with selected option
  function updateTriggerText() {
    const selectedOpt = select.options[select.selectedIndex];
    textSpan.innerText = selectedOpt ? selectedOpt.text : (title || "Select location");
    if (!select.value) {
      textSpan.style.color = "var(--color-text-secondary)";
    } else {
      textSpan.style.color = "var(--color-text-primary)";
    }
  }

  // intercept .value setter so trigger text updates when JS sets it programmatically
  const originalValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (originalValueDescriptor) {
    Object.defineProperty(select, 'value', {
      get() {
        return originalValueDescriptor.get.call(this);
      },
      set(val) {
        originalValueDescriptor.set.call(this, val);
        updateTriggerText();
      },
      configurable: true
    });
  }

  // also watch for option list changes (e.g. when locations load)
  const observer = new MutationObserver(() => {
    updateTriggerText();
  });
  observer.observe(select, { childList: true, subtree: true });

  // run once on init
  updateTriggerText();

  // clicking opens the sheet picker
  trigger.addEventListener("click", () => {
    openCustomSelectModal(select, title, updateTriggerText, caret);
  });
}

function openCustomSelectModal(select, title, onSelected, caret) {
  if (caret) caret.style.transform = "rotate(180deg)";

  const overlay = document.createElement("div");
  overlay.className = "custom-select-overlay";
  
  // build the options html
  let optionsHtml = "";
  
  const children = Array.from(select.children);
  const hasGroups = children.some(child => child.tagName === "OPTGROUP");
  
  const buildOptionRow = (option) => {
    if (!option.value) return ""; // skip the blank placeholder option
    const isSelected = option.selected ? "selected" : "";
    return `
      <div class="custom-select-option ${isSelected}" data-value="${option.value}">
        <span class="option-text">${option.text}</span>
        <i class="fas fa-check check-icon"></i>
      </div>
    `;
  };

  if (hasGroups) {
    children.forEach(child => {
      if (child.tagName === "OPTGROUP") {
        const groupLabel = child.label;
        const groupOptions = Array.from(child.children);
        optionsHtml += `
          <div class="custom-select-group">
            <div class="custom-select-group-title">${groupLabel}</div>
            <div class="custom-select-group-options">
              ${groupOptions.map(buildOptionRow).join("")}
            </div>
          </div>
        `;
      } else if (child.tagName === "OPTION") {
        optionsHtml += buildOptionRow(child);
      }
    });
  } else {
    optionsHtml = children.map(buildOptionRow).join("");
  }

  if (!optionsHtml.trim()) {
    optionsHtml = `<p class="empty-state" style="padding: var(--space-md); text-align: center; color: var(--color-text-secondary);">No options available</p>`;
  }

  const totalOptions = select.querySelectorAll("option[value]:not([value=''])").length;
  const showSearch = totalOptions > 5;

  overlay.innerHTML = `
    <div class="custom-select-sheet">
      <div class="custom-select-handle"></div>
      <div class="custom-select-header">
        <span class="custom-select-title">${title || "Select Option"}</span>
        <button class="custom-select-close">&times;</button>
      </div>
      ${showSearch ? `
      <div class="custom-select-search-container">
        <i class="fas fa-search search-icon"></i>
        <input type="text" class="custom-select-search" placeholder="Search..." autocomplete="off">
      </div>
      ` : ''}
      <div class="custom-select-options-list">
        ${optionsHtml}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  
  setTimeout(() => overlay.classList.add("show"), 10);

  const closeSelect = () => {
    overlay.classList.remove("show");
    if (caret) caret.style.transform = "";
    setTimeout(() => overlay.remove(), 250);
  };

  overlay.querySelector(".custom-select-close").addEventListener("click", closeSelect);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSelect(); });

  overlay.querySelectorAll(".custom-select-option").forEach(row => {
    row.addEventListener("click", () => {
      const val = row.dataset.value;
      select.value = val;
      select.dispatchEvent(new Event("change"));
      onSelected();
      closeSelect();
    });
  });

  if (showSearch) {
    const searchInput = overlay.querySelector(".custom-select-search");
    const optionRows = overlay.querySelectorAll(".custom-select-option");
    const groups = overlay.querySelectorAll(".custom-select-group");

    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      
      optionRows.forEach(row => {
        const text = row.querySelector(".option-text").innerText.toLowerCase();
        if (text.includes(query)) {
          row.style.display = "flex";
        } else {
          row.style.display = "none";
        }
      });

      groups.forEach(group => {
        const visibleOptions = Array.from(group.querySelectorAll(".custom-select-option")).filter(r => r.style.display !== "none");
        if (visibleOptions.length === 0) {
          group.style.display = "none";
        } else {
          group.style.display = "block";
        }
      });
    });

    setTimeout(() => searchInput.focus(), 150);
  }
}

export function initCustomSelects() {
  makeCustomSelect("pickupSelect", "Select Pickup Location");
  makeCustomSelect("dropoffSelect", "Select Drop-off Location");
  makeCustomSelect("pathfinderSelect", "Select Landmark");
}

// init the dropdowns once the DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCustomSelects);
} else {
  initCustomSelects();
}
