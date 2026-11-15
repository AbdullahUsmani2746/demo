// /app/api/[entity]/[id]/route.js
import entityModelMap from "@/lib/entityModelMap";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setAuditActor } from "@/lib/audit/context";
import { guardBy } from "@/lib/auth/route";

export async function GET(req, { params }) {
  const { entity, id } = await params;
  const config = entityModelMap[entity];

  if (!config) {
    return new Response(JSON.stringify({ error: "Invalid entity" }), {
      status: 400,
    });
  }

  try {
    const idField = config.id || "id";
    let whereClause;

    if (idField === "parameter_name") {
      whereClause = { parameter_name: id };
    } else {
      whereClause = { [idField]: parseInt(id) };
    }

    const item = await config.model.findUnique({
      where: whereClause,
      include: config.include || undefined,
    });
    return Response.json(item);
  } catch (error) {
    return new Response(JSON.stringify({ error: "Item not found" }), {
      status: 404,
    });
  }
}

export const PUT = guardBy(
  async (req, { params }) => `setup.${(await params).entity}.manage`,
  async (req, { params }) => {
  const { entity, id } = await params;
  const config = entityModelMap[entity];

  if (!config) {
    return new Response(JSON.stringify({ error: "Invalid entity" }), {
      status: 400,
    });
  }

  const trim = (data) => {
    config.fields(data);
    Object.keys(data).forEach((key) => {
      if (typeof data[key] === "string") {
        data[key] = data[key].trim();
      }
    });
    return data;
  };
  try {
    const session = await getServerSession(authOptions);
    setAuditActor(session);

    const body = await req.json();
    const idField = entityModelMap[entity].id || "id"; // e.g., "proc_ord_no" or "ccno" or default "id"
    let whereClause;

    if (idField === "parameter_name") {
      whereClause = { parameter_name: id }; // keep id as string
    } else {
      whereClause = { [idField]: parseInt(id) }; // dynamic key
    }
    let data = trim(config.fields(body));
    // Same rules as a create (e.g. an LC account must stay in its group).
    if (config.beforeUpdate) data = await config.beforeUpdate(data);
    const updated = await config.model.update({
       where: whereClause,
      data,
    });
    return Response.json(updated);
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.statusCode ? error.message : "Error updating item" }), {
      status: error?.statusCode || 500,
    });
  }
  },
);

export const DELETE = guardBy(
  async (req, { params }) => `setup.${(await params).entity}.manage`,
  async (req, { params }) => {
  const { entity, id } = await params;
  const config = entityModelMap[entity];
  const idField = entityModelMap[entity].id || "id"; // e.g., "proc_ord_no" or "ccno" or default "id"
  let whereClause;

    if (idField === "parameter_name") {
      whereClause = { parameter_name: id }; // keep id as string
    } else {
      whereClause = { [idField]: parseInt(id) }; // dynamic key
    }

  if (!config) {
    return new Response(JSON.stringify({ error: "Invalid entity" }), {
      status: 400,
    });
  }

  try {
    const session = await getServerSession(authOptions);
    setAuditActor(session);

    await config.model.delete({
     where:whereClause,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Error deleting item" }), {
      status: 500,
    });
  }
  },
);
