// js/nav.js — sidebar nav + page loader for every admin page
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

/**
 * Inject a full-screen loader. Returns { hide() } to dismiss it.
 * Call at the top of each page's script, hide after requireAdmin() resolves.
 */
export function injectPageLoader() {
  const el = document.createElement("div");
  el.id = "page-loader";
  el.style.cssText = "position:fixed;inset:0;background:#050508;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;transition:opacity 0.35s ease,visibility 0.35s ease;";
  el.innerHTML = `
    <style>
      #page-loader .pl-ring{width:52px;height:52px;border-radius:50%;border:3px solid transparent;border-top-color:#c0392b;border-right-color:rgba(192,57,43,0.3);animation:pl-spin 0.9s linear infinite;filter:drop-shadow(0 0 10px rgba(192,57,43,0.65));}
      @keyframes pl-spin{to{transform:rotate(360deg);}}
      #page-loader .pl-text{font:700 11px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#e74c3c;animation:pl-pulse 1.6s ease-in-out infinite;}
      @keyframes pl-pulse{0%,100%{opacity:.45;}50%{opacity:1;}}
    </style>
    <div class="pl-ring"></div>
    <div class="pl-text">Loading…</div>
  `;
  document.body.prepend(el);
  return {
    hide() {
      el.style.opacity = "0";
      el.style.visibility = "hidden";
      setTimeout(() => el.remove(), 380);
    }
  };
}

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
    <span class="mobile-brand"><span>Nav</span><span style="color:#c0392b">Camp</span> <small>Admin</small></span>
  `;

  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  overlay.id = "sidebar-overlay";

  document.body.prepend(overlay);
  document.body.prepend(nav);
  document.body.prepend(topbar);

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
  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", closeSidebar));
}
