import DashboardHome from "./dashboard-home";
import { requireAdminPageSession } from "../lib/admin-auth.js";
import { getAdminWorkspace, listProjects } from "../lib/control-tower.js";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireAdminPageSession();
  const [workspace, projects] = await Promise.all([getAdminWorkspace(), listProjects()]);
  return <DashboardHome session={session} workspace={workspace} projects={projects} />;
}
