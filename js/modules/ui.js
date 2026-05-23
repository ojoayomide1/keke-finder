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

// ================= BOTTOM SHEET DRAGGING =================
let startY = 0;
let currentY = 0;
let draggingSheet = null;

export function startDrag(e, sheetId) {
  draggingSheet = document.getElementById(sheetId);
  if (!draggingSheet) return;

  startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
  draggingSheet.style.transition = 'none';

  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('touchmove', handleDrag, { passive: false });
  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchend', endDrag);
}

function handleDrag(e) {
  if (!draggingSheet) return;
  if (e.type === 'touchmove') e.preventDefault();

  const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
  const deltaY = clientY - startY;

  // Only allow dragging down if expanded, or up if minimized
  const isMinimized = draggingSheet.classList.contains('minimized');
  
  if (isMinimized && deltaY > 0) return; // Can't drag further down if minimized
  if (!isMinimized && deltaY < 0) return; // Can't drag further up if expanded

  draggingSheet.style.transform = `translateY(${deltaY}px)`;
  currentY = deltaY;
}

function endDrag() {
  if (!draggingSheet) return;

  draggingSheet.style.transition = '';
  const threshold = 80;

  if (Math.abs(currentY) > threshold) {
    // Snap to new state
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

  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('touchmove', handleDrag);
  document.removeEventListener('mouseup', endDrag);
  document.removeEventListener('touchend', endDrag);
}

// Bind to window for HTML access
window.startDrag = startDrag;

export function toggleControls(show, target = "student") {
  const el = document.getElementById(`${target}Controls`);
  if (el) el.style.display = show ? "flex" : "none";
}

// New Styled Toast System
export function showToast(message, type = "info", duration = 3000) {
  const container = document.querySelector(".toast-container") ||
    (() => {
      const c = document.createElement("div");
      c.className = "toast-container";
      document.body.appendChild(c);
      return c;
    })();

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icons = {
    success: "✅", error: "❌", warning: "⚠️", info: "ℹ️"
  };

  toast.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span>${message}</span>`;
  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add("show"), 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function setButtonVisible(id, visible) {
  const btn = document.getElementById(id);
  if (btn) btn.classList.toggle("hidden", !visible);
}

export function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
}

// Confirmation Dialogs
export function showConfirmDialog({ title, message, confirmText, cancelText, onConfirm, danger = false }) {
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
    onConfirm();
    overlay.remove();
  });

  overlay.querySelector("#dialog-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

// Balance Animation
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

// Dynamic Greetings
export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning ☀️";
  if (hour < 17) return "Good afternoon 🌤️";
  return "Good evening 🌙";
}

// Splash Screen Lifecycle
export function initSplashScreen() {
  setTimeout(() => {
    const splash = document.getElementById("splash");
    if (splash) {
      splash.style.opacity = "0";
      splash.style.pointerEvents = "none";
      setTimeout(() => splash.remove(), 500);
    }
  }, 2500);
}
