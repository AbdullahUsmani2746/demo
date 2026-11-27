// Server-only: the process order reference as a Prisma SQL fragment —
// definition in lib/manufacturing/processOrderRef.js.
import { Prisma } from "@prisma/client";
import { poRefSqlText } from "@/lib/manufacturing/processOrderRef";

/** ${poRefSql("tm")} inside a $queryRaw / Prisma.sql template. */
export const poRefSql = (alias = "tm") => Prisma.raw(poRefSqlText(alias));
