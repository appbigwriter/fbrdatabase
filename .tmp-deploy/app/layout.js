import "./globals.css";

export const metadata = {
  title: "FBR-HeartBeat",
  description: "Painel admin para provisionamento e operacao de projetos multi-Postgres."
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
