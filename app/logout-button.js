"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton({ className = "" }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" className={className} onClick={handleLogout}>
      Sair
    </button>
  );
}
