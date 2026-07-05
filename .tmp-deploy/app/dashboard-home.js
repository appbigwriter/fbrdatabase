"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import LogoutButton from "./logout-button";

const defaultExpirations = {
  service: "2030-01-01T00:00:00.000Z",
  anon: "2030-01-01T00:00:00.000Z",
  mcp: "2030-01-01T00:00:00.000Z"
};

const subdomainTemplate = process.env.NEXT_PUBLIC_CONTROL_TOWER_PROJECT_SUBDOMAIN_TEMPLATE ?? "{slug}.lab.fbr.news";

export default function DashboardHome({ session, workspace, projects }) {
  const [projectList, setProjectList] = useState(projects);
  const [dashboard, setDashboard] = useState(workspace.dashboard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    slug: "",
    ownerEmail: session.email
  });

  const featured = projectList[0] ?? null;
  const projectMap = useMemo(() => new Map(projectList.map((item) => [item.id, item])), [projectList]);

  async function refreshWorkspace() {
    const [projectsResponse, workspaceResponse] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/workspace")
    ]);
    const [nextProjects, nextWorkspace] = await Promise.all([projectsResponse.json(), workspaceResponse.json()]);
    setProjectList(nextProjects);
    setDashboard(nextWorkspace.dashboard);
  }

  async function createProject(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const slug = slugify(form.slug || form.name);
      const payload = {
        name: form.name,
        slug,
        ownerEmail: form.ownerEmail,
        subdomain: subdomainTemplate.replaceAll("{slug}", slug),
        databaseName: slug.replace(/-/g, "_"),
        tokens: defaultExpirations
      };
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Nao foi possivel criar o projeto.");
        return;
      }
      setForm({ name: "", slug: "", ownerEmail: session.email });
      setSuccess(`Projeto ${result.slug} provisionado.`);
      await refreshWorkspace();
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(project) {
    const confirmation = window.prompt(`Digite o slug ${project.slug} para remover o projeto.`);
    if (!confirmation) {
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation })
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Falha ao remover o projeto.");
        return;
      }
      setSuccess(`Projeto ${project.slug} removido.`);
      await refreshWorkspace();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <h1 className={styles.brand}>FBR-<br />HeartBeat</h1>
        <p className={styles.subcopy}>Painel admin com auth dedicada, provisionamento visual e operacao centralizada.</p>

        <div className={styles.metricList}>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Projetos ativos</span>
            <strong className={styles.metricValue}>{dashboard.length}</strong>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Rotas publicadas</span>
            <strong className={styles.metricValue}>{workspace.health.routesConfigured}</strong>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Admins</span>
            <strong className={styles.metricValue}>{session.email}</strong>
          </div>
        </div>

        <nav className={styles.nav}>
          <Link href="/">Painel principal</Link>
          <Link href="/operations">Operacao e MCP</Link>
          {featured ? <Link href={`/projects/${featured.id}`}>Projeto em foco</Link> : null}
        </nav>

        <LogoutButton className={styles.secondaryAction} />
      </aside>

      <section className={styles.main}>
        <div className={styles.hero}>
          <header className={styles.topbar}>
            <div>
              <h2>Admin Workspace</h2>
              <p>Visao unificada de auth, roteamento, usuarios, storage e acoes de provisionamento.</p>
            </div>
            <div className={styles.controls}>
              <div className={styles.status}><span className={styles.dot} />Auth admin ativa</div>
            </div>
          </header>

          <div className={styles.content}>
            <aside className={styles.projectRail}>
              <p className={styles.sectionKicker}>Criar projeto</p>
              <form className={styles.createForm} onSubmit={createProject}>
                <label className={styles.field}>
                  <span>Nome</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Slug</span>
                  <input
                    value={form.slug}
                    onChange={(event) => setForm((state) => ({ ...state, slug: event.target.value }))}
                    placeholder="control-tower-blog"
                  />
                </label>
                <label className={styles.field}>
                  <span>Email responsavel</span>
                  <input
                    type="email"
                    value={form.ownerEmail}
                    onChange={(event) => setForm((state) => ({ ...state, ownerEmail: event.target.value }))}
                    required
                  />
                </label>
                <button className={styles.primaryAction} disabled={busy}>
                  {busy ? "Provisionando..." : "Novo projeto"}
                </button>
              </form>

              {error ? <p className={styles.errorMessage}>{error}</p> : null}
              {success ? <p className={styles.successMessage}>{success}</p> : null}

              <p className={styles.sectionKicker}>Projetos</p>
              <div className={styles.projectList}>
                {projectList.map((project, index) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className={`${styles.projectCard} ${index === 0 ? styles.projectCardActive : ""}`}
                  >
                    <h3>{project.name}</h3>
                    <p>{project.slug}</p>
                  </Link>
                ))}
              </div>
            </aside>

            <div className={styles.workspace}>
              <section className={styles.heroPanel}>
                <p className={styles.sectionKicker}>Painel central</p>
                <h1>Auth admin, projetos e operacao no mesmo cockpit.</h1>
                <p>
                  O dashboard agora carrega projetos reais do metadata store, mostra sinais de isolamento e permite criar
                  ou remover stacks sem sair da interface.
                </p>
                {featured ? (
                  <Link href={`/projects/${featured.id}`} className={styles.primaryAction}>
                    Abrir projeto mais recente
                  </Link>
                ) : null}
              </section>

              <div className={styles.grid}>
                <section className={`${styles.panel} ${styles.panelWide}`}>
                  <div className={styles.panelHeader}>
                    <h3>Projetos em producao</h3>
                    <span className={styles.muted}>Status, DB, usuarios, disco, auth e rotas</span>
                  </div>
                  <div className={styles.dashboardList}>
                    {dashboard.map((item) => {
                      const project = projectMap.get(item.projectId);
                      return (
                        <div className={styles.dashboardCard} key={item.projectId}>
                          <div className={styles.dashboardCardTop}>
                            <div>
                              <strong>{item.name}</strong>
                              <div className={styles.muted}>{item.subdomain}</div>
                            </div>
                            <span className={styles.statusPill}>{item.status}</span>
                          </div>
                          <div className={styles.dashboardStats}>
                            <span>DB: {item.databaseName ?? "pendente"}</span>
                            <span>Usuarios: {item.userCount}</span>
                            <span>Disco: {item.diskUsageGb.toFixed(2)} GB</span>
                            <span>Auth: {item.authStatus}</span>
                            <span>Rotas: {item.routeStatus}</span>
                            <span>Tokens: {item.tokenCount}</span>
                          </div>
                          <div className={styles.dashboardActions}>
                            <Link href={`/projects/${item.projectId}`} className={styles.inlineAction}>Abrir</Link>
                            {project ? (
                              <button
                                type="button"
                                className={styles.dangerAction}
                                disabled={busy}
                                onClick={() => removeProject(project)}
                              >
                                Remover
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className={styles.panel}>
                  <h3>Guarda operacional</h3>
                  <div className={styles.list}>
                    {workspace.securityChecklist.map((item) => (
                      <div className={styles.listItem} key={item}>
                        <div>{item}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={styles.panel}>
                  <h3>Saude do plano de controle</h3>
                  <div className={styles.list}>
                    <div className={styles.listItem}>
                      <div>Instancias auth prontas</div>
                      <strong>{workspace.health.authInstancesReady}</strong>
                    </div>
                    <div className={styles.listItem}>
                      <div>Rotas configuradas</div>
                      <strong>{workspace.health.routesConfigured}</strong>
                    </div>
                    <div className={styles.listItem}>
                      <div>Warnings</div>
                      <strong>{workspace.health.warnings?.length ?? 0}</strong>
                    </div>
                  </div>
                </section>

                <section className={styles.panel}>
                  <h3>Ferramentas liberadas</h3>
                  <div className={styles.tools}>
                    <Link className={styles.toolLink} href={featured ? `/projects/${featured.id}#sql` : "/"}>
                      <strong>Editor SQL</strong>
                      <span className={styles.muted}>Execucao direta no projeto selecionado com aviso destrutivo.</span>
                    </Link>
                    <Link className={styles.toolLink} href={featured ? `/projects/${featured.id}#tables` : "/"}>
                      <strong>Visualizador de tabelas</strong>
                      <span className={styles.muted}>Leitura operacional do schema publico e tabelas importadas.</span>
                    </Link>
                    <Link className={styles.toolLink} href={featured ? `/projects/${featured.id}#buckets` : "/"}>
                      <strong>Buckets e storage</strong>
                      <span className={styles.muted}>Buckets por projeto com uploads e visibilidade controlada.</span>
                    </Link>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
