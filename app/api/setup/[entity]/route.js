// /app/api/[entity]/route.js
import entityModelMap from "@/lib/entityModelMap";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setAuditActor } from "@/lib/audit/context";
import { guardBy } from "@/lib/auth/route";
import { setupScopeWhere, isScopedSetupEntity } from "@/lib/auth/documentScope";
import { getCompany } from "@/lib/company";

export async function GET(request, { params }) {
  try {
    const { entity } = await params;
    const config = entityModelMap[entity];

    if (!config) {
      return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    const searchQuery = searchParams.get("search");
    const sortField = searchParams.get("sortField");
    const sortOrder = searchParams.get("sortOrder") || "asc";

    // 🔹 Build dynamic filters from URL query parameters
    let dynamicFilters = {};
    searchParams.forEach((value, key) => {
      // Skip built-in params
      if (["page", "limit", "search", "sortField", "sortOrder", "includeInactive"].includes(key)) return;

      if (value === null || value === undefined) return;

      // Handle "null" as actual null
      if (value === "null") {
        dynamicFilters[key] = null;
      }
      // A list of numbers ("1,4") → any of them (e.g. items of the finished-goods
      // categories of Settings → Production setup)
      else if (/^\d+(,\d+)+$/.test(value.trim())) {
        dynamicFilters[key] = { in: value.trim().split(",").map(Number) };
      }
      // Convert numeric values to numbers
      else if (!isNaN(value) && value.trim() !== "") {
        dynamicFilters[key] = Number(value);
      }
      // Otherwise, treat as string
      else {
        dynamicFilters[key] = value;
      }
    });

    // 🔹 Build where clause
    let whereClause = { ...dynamicFilters };

    // Entities with an open/closed flag (config.activeField) list only open
    // rows by default, so every dropdown hides closed ones. Setup screens and
    // report filters pass ?includeInactive=true to see them all.
    if (config.activeField && searchParams.get("includeInactive") !== "true") {
      whereClause[config.activeField] = true;
    }

    // 🔹 New: Merge defaultWhere (an async function is resolved per request,
    // e.g. account groups from Finance → Account Settings)
    const defaultWhere =
      typeof config.defaultWhere === "function" ? await config.defaultWhere() : config.defaultWhere;
    if (defaultWhere) {
      whereClause = {
        AND: [
          defaultWhere,
          whereClause, // Combines with dynamic filters (if any)
        ].filter(Boolean), // Filters out empty objects
      };
    }

    // Data scope (Admin → Permissions): a user / department limited to some
    // godowns etc. is offered only those, in every form and report filter.
    // Which entities: lib/auth/scopeDimensions.js (setup.entity)
    const scopeWhere = isScopedSetupEntity(entity)
      ? await setupScopeWhere(await getServerSession(authOptions), entity)
      : null;
    if (scopeWhere) {
      whereClause = { AND: [whereClause, scopeWhere] };
    }

    // 🔹 Add search filters (if any)
    if (searchQuery && searchQuery.trim() !== "") {
      const searchableFields = config.searchableFields || [];
      const isNumericSearch = !isNaN(searchQuery) && searchQuery.trim() !== "";

      // Build exact match conditions (for numeric fields)
      const exactMatchConditions = [];
      // Build partial/contains match conditions (for string fields)
      const partialMatchConditions = [];

      searchableFields.forEach((rawField) => {
        const isNumberField = rawField.endsWith("?");
        const field = isNumberField ? rawField.slice(0, -1) : rawField;

        if (isNumberField) {
          // Only add numeric condition if search is a valid number
          if (isNumericSearch) {
            exactMatchConditions.push({ [field]: Number(searchQuery) });
          }
        } else {
          // String field — always add contains search
          partialMatchConditions.push({
            [field]: {
              contains: searchQuery,
              mode: "insensitive",
            },
          });

          // Also add exact match for string fields if query matches exactly
          exactMatchConditions.push({
            [field]: {
              equals: searchQuery,
              mode: "insensitive",
            },
          });
        }
      });

      // Combine: exact first, then partial
      const orConditions = [
        ...exactMatchConditions,
        ...partialMatchConditions,
      ].filter(Boolean);

      if (orConditions.length > 0) {
        whereClause.OR = orConditions;
      }
    }


    // 🔹 Helper: returns sort priority for a record
    // 0 = exact match (best), 1 = starts with, 2 = contains, 3 = no match
    const getMatchScore = (record) => {
      if (!searchQuery || searchQuery.trim() === "") return 3;
      const searchableFields = config.searchableFields || [];
      const q = searchQuery.toLowerCase().trim();
      let best = 3;
      for (const rawField of searchableFields) {
        const isNumberField = rawField.endsWith("?");
        const field = isNumberField ? rawField.slice(0, -1) : rawField;
        const val = record[field];
        if (val === undefined || val === null) continue;
        if (isNumberField) {
          if (!isNaN(searchQuery)) {
            const strVal = String(val).toLowerCase();
            if (Number(val) === Number(searchQuery) || strVal === q) {
              best = Math.min(best, 0); // exact match
            } else if (strVal.startsWith(q)) {
              best = Math.min(best, 1); // starts with
            } else if (strVal.includes(q)) {
              best = Math.min(best, 2); // contains
            }
          }
        } else {
          const strVal = String(val).toLowerCase();
          if (strVal === q) best = Math.min(best, 0);           // exact
          else if (strVal.startsWith(q)) best = Math.min(best, 1); // starts with
          else if (strVal.includes(q)) best = Math.min(best, 2);   // contains
        }
      }
      return best;
    };

    // 🔹 Sorting logic
    let orderByClause = {};
    if (sortField) {
      orderByClause[sortField] = sortOrder;
    } else {
      orderByClause = config.defaultSort || { id: "desc" };
    }

    // 🔹 Pagination check
    const shouldPaginate = pageParam !== null && limitParam !== null;

    if (shouldPaginate) {
      const page = parseInt(pageParam, 10);
      const limit = parseInt(limitParam, 10);
      const skip = (page - 1) * limit;

      const [rawData, total] = await Promise.all([
        config.model.findMany({
          where: whereClause,
          skip,
          take: limit,
          orderBy: orderByClause,
          include: config.include || undefined,
          select: config.select || undefined,
        }),
        config.model.count({
          where: whereClause,
        }),
      ]);

      // 🔹 Sort: exact → starts with → contains
      const data = searchQuery
        ? [...rawData].sort((a, b) => getMatchScore(a) - getMatchScore(b))
        : rawData;

      return NextResponse.json({
        data,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
        filters: {
          search: searchQuery,
          sortField,
          sortOrder,
        },
      });
    } else {
      // 🔹 Fetch all data (no pagination)
      const rawData = await config.model.findMany({
        where: whereClause,
        orderBy: orderByClause,
        include: config.include || undefined,
        select: config.select || undefined,
      });

      // 🔹 Sort: exact → starts with → contains
      const data = searchQuery
        ? [...rawData].sort((a, b) => getMatchScore(a) - getMatchScore(b))
        : rawData;

      return NextResponse.json({
        data,
        total: data.length,
        filters: {
          search: searchQuery,
          sortField,
          sortOrder,
        },
      });
    }
  } catch (error) {
    console.error(`Error in ${params?.entity || "unknown"} API route:`, error);

    return NextResponse.json(
      {
        error: "Failed to fetch data",
        message: error.message,
      },
      { status: 500 }
    );
  }
}


export const POST = guardBy(
  async (req, { params }) => `setup.${(await params).entity}.manage`,
  async (req, { params }) => {
  const { entity } = await params;
  const config = entityModelMap[entity];



  if (!config) {
    return new NextResponse(JSON.stringify({ error: "Invalid entity" }), {
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

    if (body.ic_id) body.ic_id = parseInt(body.ic_id);
    // An entity whose fields() take company_id gets this installation's own
    // company (Settings → Company, lib/company.js) when the form sends none.
    // (It used to be skipped whenever the body had ic_id or is_active, so a
    // new service / godown — whose forms send "Active" — was saved with
    // company_id NaN and refused.) fields() keeps only each entity's own
    // columns, so entities without a company never see it.
    if (body.company_id == null || body.company_id === "") {
      const { id: companyId } = await getCompany();
      if (companyId != null) body.company_id = companyId;
    }




    let data = trim(config.fields(body));
    if (config.beforeCreate) data = await config.beforeCreate(data);

    const newItem = await config.model.create({ data });
    return NextResponse.json(newItem);
  } catch (error) {
    if (error?.statusCode) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return NextResponse.json({ error: "Error creating item" }, { status: 500 });
  }
  },
);
