import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../../../lib/admin-route.js";
import { readProjectTable } from "../../../../../../lib/control-tower.js";

export const GET = withAdminRoute(async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json(
    await readProjectTable(params.id, params.table, {
      page: Number(searchParams.get("page") ?? "1"),
      pageSize: Number(searchParams.get("pageSize") ?? searchParams.get("limit") ?? "50"),
      sortColumn: searchParams.get("sortColumn") ?? undefined,
      sortDirection: searchParams.get("sortDirection") === "desc" ? "desc" : "asc",
      filter: searchParams.get("filter") ?? ""
    })
  );
});
