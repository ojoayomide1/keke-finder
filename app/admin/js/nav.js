// js/nav.js — injects sidebar nav into every admin page
import { adminSignOut } from "./auth.js";

const NAV_ITEMS = [
  { href: "index.html",         icon: "⚡", label: "Dashboard"      },
  { href: "users.html",         icon: "👥", label: "Users"          },
  { href: "rides.html",         icon: "🛺", label: "Rides"          },
  { href: "keke.html",          icon: "🎛️", label: "Keke Control"   },
  { href: "wallet.html",        icon: "💳", label: "Wallet"         },
  { href: "indoor-editor.html", icon: "🏢", label: "Indoor Editor"  },
  { href: "announcements.html", icon: "📢", label: "Announcements"  },
];

export function renderNav(adminName = "") {
  const current = window.location.pathname.split("/").pop() || "index.html";

  const items = NAV_ITEMS.map(({ href, icon, label }) => {
    const active = current === href ? ' class="active"' : "";
    return `<a href="${href}"${active}><span class="nav-icon">${icon}</span>${label}</a>`;
  }).join("");

  const nav = document.createElement("nav");
  nav.className = "sidebar";
  nav.innerHTML = `
    <div class="sidebar-brand">
      <span class="brand-nav">Nav</span><span class="brand-camp">Camp</span>
      <span class="brand-tag">Admin</span>
    </div>
    <div class="sidebar-links">${items}</div>
    <div class="sidebar-footer">
      <span class="admin-name">${adminName}</span>
      <button id="signout-btn" class="signout-btn">Sign out</button>
    </div>
  `;

  document.body.prepend(nav);
  document.getElementById("signout-btn").addEventListener("click", adminSignOut);
}
