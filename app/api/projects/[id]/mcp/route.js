import { NextResponse } from "next/server";
import { runProjectMcpTool } from "../../../../../lib/control-tower.js";

export async function POST(request, { params }) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
    const payload = await request.json();
    const token = bearerToken || payload.token;
    const result = await runProjectMcpTool({
      projectId: params.id,
      token,
      tool: payload.tool,
      args: payload.args
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MCP execution failed." },
      { status: 400 }
    );
  }
}
