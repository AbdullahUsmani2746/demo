// instrumentation.js — Next.js runs register() once at process start-up.
//
// The scheduled jobs live in instrumentation-node.js and are loaded only in
// the Node.js runtime. Next replaces NEXT_RUNTIME at build time, so the edge
// bundle never sees them or what they import (Prisma, node-cron, zkteco-js,
// web-push …), which it cannot resolve.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerJobs } = await import("./instrumentation-node.js");
    await registerJobs();
  }
}
