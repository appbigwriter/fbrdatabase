"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LogoutButton from "../../logout-button";
import styles from "./project-workbench.module.css";

const importSubdomainTemplate =
  process.env.NEXT_PUBLIC_CONTROL_TOWER_PROJECT_IMPORT_SUBDOMAIN_TEMPLATE ?? "{slug}-import.lab.fbr.news";

const starterSql = `select now() as timestamp, current_database() as database_name;`;
const tokenDefaults = {
  scope: "service",
  accessMode: "read-write",
  expiresAt: "2030-01-01T00:00:00.000Z"
};

export default function ProjectWorkbench({ initialDetail, session }) {
  const [detail, setDetail] = useState(initialDetail);
  const [sql, setSql] = useState(starterSql);
  const [sqlResult, setSqlResult] = useState(null);
  const [sqlError, setSqlError] = useState("");
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableResult, setTableResult] = useState(null);
  const [tableFilter, setTableFilter] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [tableState, setTableState] = useState({
    page: 1,
    pageSize: 25,
    sortColumn: "",
    sortDirection: "asc"
  });
  const [importState, setImportState] = useState({ busy: false, result: null, error: "" });
  const [bucketForm, setBucketForm] = useState({ name: "", visibility: "public", backend: "ssd" });
  const [bucketFiles, setBucketFiles] = useState({});
  const [tokenForm, setTokenForm] = useState(tokenDefaults);
  const [tokenState, setTokenState] = useState({ busy: false, error: "", issued: null });
  const [backupState, setBackupState] = useState({ busy: false, error: "", created: null });

  const destructive = useMemo(() => /\b(drop|truncate|delete|alter)\b/i.test(sql), [sql]);
  const sqlHistory = detail.sqlHistory ?? [];

  useEffect(() => {
    loadTables();
  }, [detail.project.id, tableFilter]);

  useEffect(() => {
    if (tables[0] && !tables.find((table) => table.tableName === selectedTable)) {
      setSelectedTable(tables[0].tableName);
    }
    if (!selectedTable && tables[0]) {
      setSelectedTable(tables[0].tableName);
    }
  }, [tables, selectedTable]);

  useEffect(() => {
    if (selectedTable) {
      loadRows(selectedTable);
    }
  }, [selectedTable, tableState.page, tableState.pageSize, tableState.sortColumn, tableState.sortDirection, tableSearch]);

  async function refreshDetail() {
    const response = await fetch(`/api/projects/${detail.project.id}`);
    setDetail(await response.json());
  }

  async function loadTables() {
    const query = new URLSearchParams();
    if (tableFilter.trim()) {
      query.set("filter", tableFilter.trim());
    }
    const response = await fetch(`/api/projects/${detail.project.id}/tables?${query.toString()}`);
    setTables(await response.json());
  }

  async function loadRows(tableName, overrides = {}) {
    const params = new URLSearchParams({
      page: String(overrides.page ?? tableState.page),
      pageSize: String(overrides.pageSize ?? tableState.pageSize),
      sortDirection: String(overrides.sortDirection ?? tableState.sortDirection)
    });
    const sortColumn = overrides.sortColumn ?? tableState.sortColumn;
    const filter = overrides.filter ?? tableSearch;
    if (sortColumn) {
      params.set("sortColumn", sortColumn);
    }
    if (filter.trim()) {
      params.set("filter", filter.trim());
    }
    const response = await fetch(`/api/projects/${detail.project.id}/tables/${tableName}?${params.toString()}`);
    const payload = await response.json();
    setTableResult(payload);
  }

  async function runSql() {
    setSqlError("");
    const response = await fetch(`/api/projects/${detail.project.id}/sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql })
    });
    const payload = await response.json();
    if (!response.ok) {
      setSqlResult(null);
      setSqlError(payload.error ?? "Falha ao executar SQL");
      return;
    }
    setSqlResult(payload);
    await Promise.all([refreshDetail(), loadTables()]);
    if (selectedTable) {
      await loadRows(selectedTable);
    }
  }

  async function issueToken(event) {
    event.preventDefault();
    setTokenState({ busy: true, error: "", issued: null });
    const response = await fetch(`/api/projects/${detail.project.id}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenForm)
    });
    const payload = await response.json();
    if (!response.ok) {
      setTokenState({ busy: false, error: payload.error ?? "Falha ao emitir token.", issued: null });
      return;
    }
    setTokenState({ busy: false, error: "", issued: payload });
    await refreshDetail();
  }

  async function revokeToken(tokenId) {
    await fetch(`/api/projects/${detail.project.id}/tokens/${tokenId}`, { method: "POST" });
    await refreshDetail();
  }

  async function createBucketAction(event) {
    event.preventDefault();
    await fetch(`/api/projects/${detail.project.id}/buckets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bucketForm)
    });
    setBucketForm({ name: "", visibility: "public", backend: "ssd" });
    await refreshDetail();
  }

  async function uploadBucketFile(bucketName, file) {
    const formData = new FormData();
    formData.append("file", file);
    await fetch(`/api/projects/${detail.project.id}/buckets/${bucketName}/files`, {
      method: "POST",
      body: formData
    });
    await loadBucketFiles(bucketName);
  }

  async function loadBucketFiles(bucketName) {
    const response = await fetch(`/api/projects/${detail.project.id}/buckets/${bucketName}/files`);
    const files = await response.json();
    setBucketFiles((current) => ({ ...current, [bucketName]: files }));
  }

  async function runImport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    setImportState({ busy: true, result: null, error: "" });
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      setImportState({ busy: false, result: null, error: result.error ?? "Importacao falhou" });
      return;
    }
    setImportState({ busy: false, result, error: "" });
  }

  async function runBackup() {
    setBackupState({ busy: true, error: "", created: null });
    const response = await fetch(`/api/projects/${detail.project.id}/backups`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setBackupState({ busy: false, error: payload.error ?? "Falha ao gerar backup.", created: null });
      return;
    }
    setBackupState({ busy: false, error: "", created: payload });
    await refreshDetail();
  }

  async function restoreBackup(fileName) {
    setBackupState({ busy: true, error: "", created: null });
    const response = await fetch(
      `/api/projects/${detail.project.id}/backups/${encodeURIComponent(fileName)}/restore`,
      { method: "POST" }
    );
    const payload = await response.json();
    if (!response.ok) {
      setBackupState({ busy: false, error: payload.error ?? "Falha ao restaurar backup.", created: null });
      return;
    }
    setBackupState({ busy: false, error: "", created: { fileName: payload.restored } });
    await refreshDetail();
  }

  function changeTableSort(column) {
    setTableState((current) => ({
      ...current,
      page: 1,
      sortColumn: column,
      sortDirection: current.sortColumn === column && current.sortDirection === "asc" ? "desc" : "asc"
    }));
  }

  function applyTableSearch(event) {
    event.preventDefault();
    setTableState((current) => ({ ...current, page: 1 }));
    loadRows(selectedTable, { page: 1, filter: tableSearch });
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{detail.project.name}</h1>
          <p>{detail.project.slug} · {detail.project.status} · {detail.database?.databaseName}</p>
        </div>
        <div className={styles.headerNav}>
          <span className={styles.muted}>{session.email}</span>
          <Link href="/">Painel</Link>
          <Link href="/operations">Operacao</Link>
          <LogoutButton className={styles.button} />
        </div>
      </header>

      <div className={styles.layout}>
        <main className={styles.main}>
          <section className={styles.hero}>
            <div className={styles.tile}><span>Subdominio</span><strong>{detail.project.subdomain}</strong></div>
            <div className={styles.tile}><span>Auth</span><strong>{detail.auth?.status ?? "indisponivel"}</strong></div>
            <div className={styles.tile}><span>Tokens</span><strong>{detail.tokens.length}</strong></div>
            <div className={styles.tile}><span>Buckets</span><strong>{detail.buckets.length}</strong></div>
          </section>

          <section className={styles.section} id="sql">
            <div className={styles.sectionHeader}>
              <div>
                <h2>Editor SQL</h2>
                <p>Opera diretamente no database do projeto selecionado. O aviso destrutivo aparece antes da execucao.</p>
              </div>
            </div>
            <textarea className={styles.sqlEditor} value={sql} onChange={(event) => setSql(event.target.value)} />
            <div className={styles.toolbar}>
              <button className={styles.button} onClick={runSql}>Executar SQL</button>
              {destructive ? <span className={styles.warning}>Comando destrutivo detectado. Revise antes de seguir.</span> : null}
              {sqlError ? <span className={styles.warning}>{sqlError}</span> : null}
            </div>
            {sqlResult ? (
              <div className={styles.results}>
                <strong>{sqlResult.rowCount} linhas</strong>
                <pre>{JSON.stringify(sqlResult.rows, null, 2)}</pre>
              </div>
            ) : null}

            <div className={styles.historyBlock}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3>Historico recente</h3>
                  <p>Ultimas queries executadas neste projeto com status e volume de retorno.</p>
                </div>
              </div>
              <div className={styles.list}>
                {sqlHistory.map((entry) => (
                  <div className={styles.listRow} key={entry.id}>
                    <div className={styles.historyItem}>
                      <strong>{entry.status}</strong>
                      <div className={styles.muted}>{entry.executedAt} · {entry.rowCount} linhas</div>
                      <code className={styles.inlineCode}>{entry.sql}</code>
                      {entry.message ? <div className={styles.warning}>{entry.message}</div> : null}
                    </div>
                    <button className={`${styles.button} ${styles.ghost}`} onClick={() => setSql(entry.sql)}>Reusar</button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.section} id="tables">
            <div className={styles.sectionHeader}>
              <div>
                <h2>Visualizador de tabelas</h2>
                <p>Filtro por nome, busca textual, ordenacao de colunas e paginação por tabela.</p>
              </div>
              <select value={selectedTable} onChange={(event) => setSelectedTable(event.target.value)}>
                <option value="">Selecione</option>
                {tables.map((table) => (
                  <option key={table.tableName} value={table.tableName}>{table.tableName}</option>
                ))}
              </select>
            </div>

            <div className={styles.toolbar}>
              <input
                className={styles.searchInput}
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value)}
                placeholder="Filtrar tabelas por nome"
              />
              <form className={styles.inlineForm} onSubmit={applyTableSearch}>
                <input
                  className={styles.searchInput}
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                  placeholder="Buscar texto na tabela aberta"
                />
                <button className={`${styles.button} ${styles.ghost}`}>Buscar</button>
              </form>
            </div>

            <div className={styles.list}>
              {tables.map((table) => (
                <div className={styles.listRow} key={table.tableName}>
                  <div>
                    <strong>{table.tableName}</strong>
                    <div className={styles.muted}>~{table.estimatedRows} linhas · {table.columns.join(", ") || "sem colunas"}</div>
                  </div>
                  <button
                    className={`${styles.button} ${styles.ghost}`}
                    onClick={() => {
                      setSelectedTable(table.tableName);
                      setTableState((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    Abrir
                  </button>
                </div>
              ))}
            </div>

            {tableResult ? (
              <div className={styles.results}>
                <div className={styles.toolbar}>
                  <strong>
                    {tableResult.tableName} · {tableResult.totalRows} linhas · pagina {tableResult.page}/{tableResult.totalPages}
                  </strong>
                  <select
                    value={tableState.pageSize}
                    onChange={(event) =>
                      setTableState((current) => ({ ...current, page: 1, pageSize: Number(event.target.value) }))
                    }
                  >
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>

                <table className={styles.table}>
                  <thead>
                    <tr>
                      {tableResult.columns.map((column) => (
                        <th key={column}>
                          <button className={styles.sortButton} onClick={() => changeTableSort(column)}>
                            {column}
                            {tableResult.sort.column === column ? ` ${tableResult.sort.direction}` : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableResult.rows.map((row, index) => (
                      <tr key={index}>
                        {tableResult.columns.map((column) => (
                          <td key={column}>{stringifyCell(row[column])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className={styles.pagination}>
                  <button
                    className={`${styles.button} ${styles.ghost}`}
                    disabled={tableResult.page <= 1}
                    onClick={() => setTableState((current) => ({ ...current, page: current.page - 1 }))}
                  >
                    Pagina anterior
                  </button>
                  <button
                    className={`${styles.button} ${styles.ghost}`}
                    disabled={tableResult.page >= tableResult.totalPages}
                    onClick={() => setTableState((current) => ({ ...current, page: current.page + 1 }))}
                  >
                    Proxima pagina
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className={styles.section} id="buckets">
            <div className={styles.sectionHeader}>
              <div>
                <h2>Buckets e storage</h2>
                <p>Cria buckets por projeto, controla visibilidade e faz upload de arquivos para inspecao operacional.</p>
              </div>
            </div>
            <form className={styles.form} onSubmit={createBucketAction}>
              <div className={styles.field}>
                <label>Nome do bucket</label>
                <input value={bucketForm.name} onChange={(event) => setBucketForm((state) => ({ ...state, name: event.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Visibilidade</label>
                <select value={bucketForm.visibility} onChange={(event) => setBucketForm((state) => ({ ...state, visibility: event.target.value }))}>
                  <option value="public">public</option>
                  <option value="private">private</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Backend</label>
                <select value={bucketForm.backend} onChange={(event) => setBucketForm((state) => ({ ...state, backend: event.target.value }))}>
                  <option value="ssd">ssd quente</option>
                  <option value="nas">nas frio</option>
                </select>
              </div>
              <button className={styles.button}>Criar bucket</button>
            </form>

            <div className={styles.sectionGrid}>
              {detail.buckets.map((bucket) => (
                <div key={bucket.id} className={styles.section}>
                  <h3>{bucket.name}</h3>
                  <p className={styles.muted}>{bucket.visibility} · {bucket.backend} · cache {bucket.cacheMode}</p>
                  <div className={styles.uploadRow}>
                    <input
                      type="file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) uploadBucketFile(bucket.name, file);
                      }}
                    />
                    <button className={`${styles.button} ${styles.ghost}`} onClick={() => loadBucketFiles(bucket.name)}>Atualizar arquivos</button>
                  </div>
                  <div className={styles.list}>
                    {(bucketFiles[bucket.name] ?? []).map((file) => (
                      <div key={file.name} className={styles.listRow}>
                        <div>
                          <strong>{file.name}</strong>
                          <div className={styles.muted}>{file.size} bytes</div>
                          {file.publicUrl ? (
                            <a className={styles.inlineLink} href={file.publicUrl} target="_blank" rel="noreferrer">
                              abrir publico
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section} id="backups">
            <div className={styles.sectionHeader}>
              <div>
                <h2>Backups</h2>
                <p>Dump por projeto com artefato versionado e status registrado na auditoria.</p>
              </div>
              <button className={styles.button} disabled={backupState.busy} onClick={runBackup}>
                {backupState.busy ? "Gerando..." : "Gerar backup agora"}
              </button>
            </div>
            {backupState.error ? <p className={styles.warning}>{backupState.error}</p> : null}
            {backupState.created ? (
              <div className={styles.secretPanel}>
                <strong>Backup criado</strong>
                <div className={styles.muted}>{backupState.created.fileName}</div>
              </div>
            ) : null}
            <div className={styles.list}>
              {(detail.backups ?? []).map((backup) => (
                <div className={styles.listRow} key={backup.id}>
                  <div>
                    <strong>{backup.fileName}</strong>
                    <div className={styles.muted}>{backup.createdAt} · {backup.sizeBytes} bytes</div>
                  </div>
                  <div className={styles.actionGroup}>
                    <span>{backup.status}</span>
                    <button className={`${styles.button} ${styles.ghost}`} onClick={() => restoreBackup(backup.fileName)}>
                      Restaurar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>

        <aside className={styles.aside}>
          <section className={styles.section}>
            <h2>Tokens</h2>
            <form className={styles.form} onSubmit={issueToken}>
              <div className={styles.field}>
                <label>Escopo</label>
                <select
                  value={tokenForm.scope}
                  onChange={(event) =>
                    setTokenForm((state) => ({
                      ...state,
                      scope: event.target.value,
                      accessMode: event.target.value === "mcp" ? "read-only" : state.accessMode
                    }))
                  }
                >
                  <option value="service">service</option>
                  <option value="anon">anon</option>
                  <option value="mcp">mcp</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Modo de acesso</label>
                <select
                  value={tokenForm.accessMode}
                  onChange={(event) => setTokenForm((state) => ({ ...state, accessMode: event.target.value }))}
                >
                  <option value="read-write">read-write</option>
                  <option value="read-only">read-only</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Expira em</label>
                <input
                  value={tokenForm.expiresAt}
                  onChange={(event) => setTokenForm((state) => ({ ...state, expiresAt: event.target.value }))}
                />
              </div>
              <button className={styles.button} disabled={tokenState.busy}>
                {tokenState.busy ? "Emitindo..." : "Emitir token"}
              </button>
            </form>
            {tokenState.error ? <p className={styles.warning}>{tokenState.error}</p> : null}
            {tokenState.issued ? (
              <div className={styles.secretPanel}>
                <strong>Segredo gerado agora</strong>
                <code className={styles.inlineCode}>{tokenState.issued.secret}</code>
              </div>
            ) : null}
            <div className={styles.list}>
              {detail.tokens.map((token) => (
                <div className={styles.listRow} key={token.id}>
                  <div>
                    <strong>{token.scope}</strong>
                    <div className={styles.muted}>{token.accessMode} · expira {token.expiresAt}</div>
                  </div>
                  {token.revokedAt ? (
                    <span className={styles.muted}>revogado</span>
                  ) : (
                    <button className={`${styles.button} ${styles.ghost}`} onClick={() => revokeToken(token.id)}>Revogar</button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2>Importador Supabase</h2>
            <form className={styles.form} onSubmit={runImport}>
              <input type="hidden" name="name" value={`${detail.project.name} import`} />
              <input type="hidden" name="slug" value={`${detail.project.slug}-import`} />
              <input
                type="hidden"
                name="subdomain"
                value={importSubdomainTemplate.replaceAll("{slug}", detail.project.slug)}
              />
              <input type="hidden" name="databaseName" value={`${detail.project.slug.replace(/-/g, "_")}_import`} />
              <input type="hidden" name="ownerEmail" value="admin@fbr.news" />
              <div className={styles.field}>
                <label>Connection string de origem</label>
                <input name="sourceConnectionString" placeholder="postgres://..." />
              </div>
              <div className={styles.field}>
                <label>Email para validar login migrado</label>
                <input name="verifyEmail" placeholder="usuario@origem.com" />
              </div>
              <div className={styles.field}>
                <label>Senha para validar login migrado</label>
                <input name="verifyPassword" type="password" placeholder="opcional" />
              </div>
              <button className={styles.button} disabled={importState.busy}>
                {importState.busy ? "Importando..." : "Rodar importacao"}
              </button>
            </form>
            {importState.error ? <p className={styles.warning}>{importState.error}</p> : null}
            {importState.result ? (
              <pre>{JSON.stringify(importState.result.report, null, 2)}</pre>
            ) : null}
          </section>

          <section className={styles.section}>
            <h2>MCP e operacao</h2>
            <div className={styles.list}>
              <div className={styles.listRow}>
                <div>
                  <strong>Escopo MCP</strong>
                  <div className={styles.muted}>{detail.mcp.tokenScope} · escrita exige confirmacao</div>
                </div>
              </div>
              {detail.mcp.tools.map((tool) => (
                <div className={styles.listRow} key={tool}>
                  <div>{tool}</div>
                </div>
              ))}
              <div className={styles.listRow}>
                <div>
                  <strong>Rota atual</strong>
                  <div className={styles.muted}>{detail.route?.authTarget ?? "sem route"}</div>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function stringifyCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
