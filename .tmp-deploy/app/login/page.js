import { redirect } from "next/navigation";
import { getAdminSession } from "../../lib/admin-auth.js";
import LoginForm from "./login-form";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getAdminSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className={styles.shell}>
      <section className={styles.panel}>
        <p className={styles.kicker}>FBR-HeartBeat</p>
        <h1>Entrar no painel admin</h1>
        <p className={styles.copy}>
          Acesso restrito a administradores autorizados. Em producao, a autenticacao deve apontar para um GoTrue
          dedicado do painel.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
