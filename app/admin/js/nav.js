// js/nav.js — injects sidebar nav into every admin page
import { adminSignOut } from "./auth.js";

const NAV_ITEMS = [
  { href: "dashboard.html",    icon: "⚡", label: "Dashboard"      },
  { href: "users.html",        icon: "👥", label: "Users"          },
  { href: "rides.html",        icon: "🛺", label: "Rides"          },
  { href: "keke.html",         icon: "🎛️", label: "Keke Control"   },
  { href: "wallet.html",       icon: "💳", label: "Wallet"         },
  { href: "indoor-editor.html",icon: "🏢", label: "Indoor Editor"  },
  { href: "announcements.html",icon: "📢", label: "Announcements"  },
];

export function renderNav(adminName = "") {
  const current = window.location.pathname.split("/").pop() || "dashboard.html";

  const items = NAV_ITEMS.map(({ href, icon, label }) => {
    const active = current === href ? ' class="active"' : "";
    return `<a href="${href}"${active}><span class="nav-icon">${icon}</span>${label}</a>`;
  }).join("");

  // Sidebar
  const nav = document.createElement("nav");
  nav.className = "sidebar";
  nav.id = "sidebar";
  nav.innerHTML = `
    <div class="sidebar-brand">
      <span class="brand-nav">Nav</span><span class="brand-camp">Camp</span>
      <span class="brand-tag">Admin</span>
      <button class="sidebar-close" id="sidebar-close" aria-label="Close menu">✕</button>
    </div>
    <div class="sidebar-links">${items}</div>
    <div class="sidebar-footer">
      <span class="admin-name">${adminName}</span>
      <button id="signout-btn" class="signout-btn">Sign out</button>
    </div>
  `;

  // Mobile top bar
  const topbar = document.createElement("div");
  topbar.className = "mobile-topbar";
  topbar.innerHTML = `
    <button class="menu-btn" id="menu-btn" aria-label="Open menu">☰</button>
    <span class="mobile-brand"><span>Nav</span><span style="color:#1E7A46">Camp</span> <small>Admin</small></span>
  `;

  // Overlay
  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  overlay.id = "sidebar-overlay";

  document.body.prepend(overlay);
  document.body.prepend(nav);
  document.body.prepend(topbar);

  // Events
  document.getElementById("signout-btn").addEventListener("click", adminSignOut);

  document.getElementById("menu-btn").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebar-overlay").classList.add("show");
  });

  function closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("show");
  }

  document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
  document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar);

  // Close sidebar on nav link tap (mobile)
  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", closeSidebar));
}
