/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  output: "standalone",
  // node-cron (used by instrumentation.js) pulls in Node built-ins
  // (child_process, path, node:crypto) that webpack can't bundle —
  // this keeps it as a real runtime require() instead.
  // zkteco-js (HR attendance machines, lib/hr/devices.js) talks raw TCP/UDP
  // through net / dgram — likewise a plain runtime require().
  // web-push (phone notifications, lib/notifications/push.js) uses https /
  // crypto — kept as a runtime require() too.
  serverExternalPackages: ["node-cron", "zkteco-js", "web-push"],
  env: {
    WOOCOMMERCE_URL: process.env.WOOCOMMERCE_URL,
    WOOCOMMERCE_CONSUMER_KEY: process.env.WOOCOMMERCE_CONSUMER_KEY,
    WOOCOMMERCE_CONSUMER_SECRET: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  },
  transpilePackages: ["chart.js", "react-chartjs-2"],
  // The old /employer area (a second copy of the setup screens) is gone:
  // every setup screen, Employees included, lives at /accounting/setup/<entity>.
  // Phone notifications: the service worker must never be served from a
  // cache, or phones keep an old copy (public/sw.js).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  async redirects() {
    return [{ source: "/employer/setup/:entity", destination: "/accounting/setup/:entity", permanent: true }];
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "82.112.254.65",
        port: "3001",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
