export function updateBottomSheet(title, sub, target = "student") {
  const sheet = document.getElementById(`${target}Sheet`);
  if (!sheet) return;
  const h3 = sheet.querySelector("h3");
  const p = sheet.querySelector("p");
  if (h3) h3.innerText = title;
  if (p) p.innerText = sub;
}

export function updateRideDetails(target, details) {
  const container = document.getElementById(`${target}RideDetails`);
  if (!container) return;
  container.innerHTML = details.map(d => `
    <div class="ride-detail"><span>${d.label}</span><strong>${d.value}</strong></div>
  `).join("");
}

export function toggleControls(show, target = "student") {
  const el = document.getElementById(`${target}Controls`);
  if (el) el.style.display = show ? "flex" : "none";
}

export function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type} show`;
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => { 
    toast.classList.remove("show"); 
    setTimeout(() => toast.remove(), 300); 
  }, 2500);
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
