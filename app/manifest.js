// Web app manifest (/manifest.webmanifest) — lets people "Add to Home Screen"
// / "Install app" so the system opens like an app and can receive phone
// notifications (public/sw.js, lib/notifications/push.js). Name from the
// Company table, like the page title (app/layout.js).
import { getCompany, companyShortName, DEFAULT_COMPANY_NAME } from "@/lib/company";

// Read on every request: a manifest baked at build time (no database there)
// would install the app under the neutral name "Company".
export const dynamic = "force-dynamic";

export default async function manifest() {
  let name = DEFAULT_COMPANY_NAME;
  try {
    name = (await getCompany()).name || DEFAULT_COMPANY_NAME;
  } catch {
    // DB unreachable — neutral name; the next request tries again
  }
  return {
    id: "/",
    name,
    short_name: companyShortName(name),
    description: `${name} — accounts, inventory, production and approvals`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#800000",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Approvals", url: "/dashboard/approvals", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Notifications", url: "/accounting/notifications", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
