import { notFound } from "next/navigation";
import { requireAdminPageSession } from "../../../lib/admin-auth.js";
import { getProjectDetail } from "../../../lib/control-tower.js";
import ProjectWorkbench from "./project-workbench";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }) {
  try {
    const session = await requireAdminPageSession();
    const detail = await getProjectDetail(params.id);
    return <ProjectWorkbench initialDetail={detail} session={session} />;
  } catch {
    notFound();
  }
}
