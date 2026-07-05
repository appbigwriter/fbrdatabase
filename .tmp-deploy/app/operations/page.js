import Link from "next/link";
import LogoutButton from "../logout-button";
import OperationsActions from "./operations-actions";
import { requireAdminPageSession } from "../../lib/admin-auth.js";
import { getOperationsSnapshot } from "../../lib/control-tower.js";
import styles from "../projects/[id]/project-workbench.module.css";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const session = await requireAdminPageSession();
  const snapshot = await getOperationsSnapshot();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Operacao e MCP</h1>
          <p>Auditoria recente, rotas ativas, inventario de tokens e a superficie de operacao do control plane.</p>
        </div>
        <div className={styles.headerNav}>
          <span className={styles.muted}>{session.email}</span>
          <Link href="/">Painel</Link>
          <LogoutButton className={styles.button} />
        </div>
      </header>

      <div className={styles.layout}>
        <main className={styles.main}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Saude do host</h2>
                <p>Memoria, uptime e alertas agregados do ambiente de operacao.</p>
              </div>
            </div>
            <div className={styles.list}>
              <div className={styles.listRow}>
                <div>
                  <strong>{snapshot.systemHealth.host.platform}</strong>
                  <div className={styles.muted}>uptime {snapshot.systemHealth.host.uptimeSeconds}s</div>
                </div>
                <div>
                  {snapshot.systemHealth.host.freeMemoryMb} / {snapshot.systemHealth.host.totalMemoryMb} MB livres
                </div>
              </div>
              <div className={styles.listRow}>
                <div>
                  <strong>CPU e disco</strong>
                  <div className={styles.muted}>
                    {snapshot.systemHealth.host.cpuCores} cores · load {snapshot.systemHealth.host.loadAverage.join(", ")}
                  </div>
                </div>
                <div>
                  {snapshot.systemHealth.host.diskFreeGb} / {snapshot.systemHealth.host.diskTotalGb} GB livres
                </div>
              </div>
              {snapshot.systemHealth.warnings.map((warning) => (
                <div className={styles.listRow} key={warning}>
                  <div className={styles.warning}>{warning}</div>
                </div>
              ))}
            </div>
          </section>

          <OperationsActions projects={snapshot.projects} />

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Containers</h2>
                <p>Status dos componentes base e das instancias auth provisionadas.</p>
              </div>
            </div>
            <div className={styles.list}>
              {snapshot.systemHealth.containers.map((container) => (
                <div className={styles.listRow} key={container.name}>
                  <div>
                    <strong>{container.name}</strong>
                    <div className={styles.muted}>health {container.health}</div>
                  </div>
                  <div>{container.status}</div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Rotas publicadas</h2>
                <p>Subdominios atualmente ligados ao Caddy e seus alvos de auth.</p>
              </div>
            </div>
            <div className={styles.list}>
              {snapshot.routes.map((route) => (
                <div className={styles.listRow} key={route.projectId}>
                  <div>
                    <strong>{route.subdomain}</strong>
                    <div className={styles.muted}>{route.authTarget}</div>
                  </div>
                  <div>{route.tlsMode}</div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Auditoria recente</h2>
                <p>Ultimos eventos de provisionamento, rollback e operacao.</p>
              </div>
            </div>
            <div className={styles.list}>
              {snapshot.auditLogs.map((entry) => (
                <div className={styles.listRow} key={entry.id}>
                  <div>
                    <strong>{entry.action}</strong>
                    <div className={styles.muted}>{entry.createdAt}</div>
                  </div>
                  <div>{entry.phase}</div>
                </div>
              ))}
            </div>
          </section>
        </main>

        <aside className={styles.aside}>
          <section className={styles.section}>
            <h2>Tokens</h2>
            <div className={styles.list}>
              {snapshot.tokens.slice(-12).map((token) => (
                <div className={styles.listRow} key={token.id}>
                  <div>
                    <strong>{token.scope}</strong>
                    <div className={styles.muted}>{token.projectId}</div>
                  </div>
                  <div>{token.accessMode}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
