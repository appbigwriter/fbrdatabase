"use client";

import { useState } from "react";
import styles from "../projects/[id]/project-workbench.module.css";

export default function OperationsActions({ projects }) {
  const [form, setForm] = useState({
    sourceProjectId: projects[0]?.id ?? "",
    targetProjectId: projects[1]?.id ?? projects[0]?.id ?? "",
    email: "isolamento@fbr.news",
    password: "ControlTower123!"
  });
  const [state, setState] = useState({ busy: false, error: "", result: null });

  async function runIsolationCheck(event) {
    event.preventDefault();
    setState({ busy: true, error: "", result: null });
    const response = await fetch("/api/operations/isolation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = await response.json();
    if (!response.ok) {
      setState({ busy: false, error: payload.error ?? "Falha no teste de isolamento.", result: null });
      return;
    }
    setState({ busy: false, error: "", result: payload });
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Prova de isolamento</h2>
          <p>Cria ou reaproveita um usuario no projeto de origem e valida falha de login cruzado no destino.</p>
        </div>
      </div>

      <form className={styles.form} onSubmit={runIsolationCheck}>
        <div className={styles.field}>
          <label>Projeto de origem</label>
          <select
            value={form.sourceProjectId}
            onChange={(event) => setForm((state) => ({ ...state, sourceProjectId: event.target.value }))}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.slug}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label>Projeto de destino</label>
          <select
            value={form.targetProjectId}
            onChange={(event) => setForm((state) => ({ ...state, targetProjectId: event.target.value }))}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.slug}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label>Email de teste</label>
          <input value={form.email} onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))} />
        </div>
        <div className={styles.field}>
          <label>Senha de teste</label>
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))}
          />
        </div>
        <button className={styles.button} disabled={state.busy}>
          {state.busy ? "Validando..." : "Rodar prova de isolamento"}
        </button>
      </form>

      {state.error ? <p className={styles.warning}>{state.error}</p> : null}
      {state.result ? (
        <div className={styles.secretPanel}>
          <strong>{state.result.isolated ? "Isolamento confirmado" : "Isolamento falhou"}</strong>
          <div className={styles.muted}>origem {String(state.result.sourceLogin)} · destino {String(state.result.targetLogin)}</div>
        </div>
      ) : null}
    </section>
  );
}
