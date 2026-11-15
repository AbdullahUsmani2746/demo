// scripts/demo/create-admin.mjs — the demo Super Admin login (demo database only).
//   node --env-file=.env scripts/demo/create-admin.mjs
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

if (!(process.env.DEMO_DATABASE === "1" || process.env.DATABASE_URL?.includes("bizlogist_demo"))) {
  console.error("Refusing: DATABASE_URL is not the demo database.");
  process.exit(1);
}
const prisma = new PrismaClient();
const password = await bcrypt.hash("demo123", 12);
await prisma.user.upsert({
  where: { username: "admin" },
  update: { role: "ADMIN", isActive: true },
  create: { id: "demo-admin", username: "admin", name: "Demo Admin", email: "admin@bizlogist.demo", role: "ADMIN", isActive: true, password },
});
console.log("Super Admin: admin / demo123");
await prisma.$disconnect();
