export interface StoryModule {
  id: string;
  title: string;
  status: "implemented" | "scaffolded";
  modules: string[];
}

export const storyMap: StoryModule[] = [
  { id: "CT-001", title: "Automate backups and restore proof", status: "implemented", modules: ["services.backup"] },
  { id: "CT-002", title: "Define TLS strategy", status: "implemented", modules: ["services.tls"] },
  { id: "CT-003", title: "Create metadata schema", status: "implemented", modules: ["sql.001_control_plane", "store"] },
  { id: "CT-004", title: "Structured audit trail", status: "implemented", modules: ["services.audit"] },
  { id: "CT-005", title: "Create project database", status: "implemented", modules: ["services.provisioning"] },
  { id: "CT-006", title: "Create writer and reader roles", status: "implemented", modules: ["services.provisioning"] },
  { id: "CT-007", title: "Provision auth instance", status: "implemented", modules: ["services.provisioning"] },
  { id: "CT-008", title: "Register project route", status: "implemented", modules: ["services.provisioning"] },
  { id: "CT-009", title: "Issue initial tokens", status: "implemented", modules: ["services.tokens"] },
  { id: "CT-010", title: "Atomic provisioning with rollback", status: "implemented", modules: ["services.provisioning"] },
  { id: "CT-011", title: "Validate provisioning acceptance", status: "implemented", modules: ["tests.control-tower"] },
  { id: "CT-012", title: "Safe deprovisioning", status: "implemented", modules: ["services.deprovision"] },
  { id: "CT-013", title: "Dynamic route config API", status: "scaffolded", modules: ["services.routing"] },
  { id: "CT-014", title: "Route with Caddy", status: "scaffolded", modules: ["services.routing"] },
  { id: "CT-015", title: "User isolation proof", status: "scaffolded", modules: ["services.routing"] },
  { id: "CT-016", title: "Public read cache", status: "scaffolded", modules: ["services.routing", "services.storage"] },
  { id: "CT-017", title: "Importer intake flow", status: "implemented", modules: ["services.importer"] },
  { id: "CT-018", title: "Import public and auth schemas", status: "implemented", modules: ["services.importer"] },
  { id: "CT-019", title: "Recreate Supabase roles", status: "implemented", modules: ["services.importer"] },
  { id: "CT-020", title: "Validate preserved login", status: "implemented", modules: ["services.importer"] },
  { id: "CT-021", title: "Migration report", status: "implemented", modules: ["services.importer"] },
  { id: "CT-022", title: "Admin panel auth", status: "scaffolded", modules: ["services.panel"] },
  { id: "CT-023", title: "Projects dashboard", status: "implemented", modules: ["services.panel"] },
  { id: "CT-024", title: "Project detail navigation", status: "scaffolded", modules: ["services.panel"] },
  { id: "CT-025", title: "SQL editor", status: "scaffolded", modules: ["services.panel"] },
  { id: "CT-026", title: "Table viewer", status: "scaffolded", modules: ["services.panel"] },
  { id: "CT-027", title: "Token management UI", status: "implemented", modules: ["services.panel", "services.tokens"] },
  { id: "CT-028", title: "Importer UI", status: "scaffolded", modules: ["services.panel", "services.importer"] },
  { id: "CT-029", title: "System health view", status: "implemented", modules: ["services.health"] },
  { id: "CT-030", title: "Backup status in dashboard", status: "implemented", modules: ["services.panel", "services.backup"] },
  { id: "CT-031", title: "Buckets per project", status: "implemented", modules: ["services.storage"] },
  { id: "CT-032", title: "Uploads and visibility policy", status: "implemented", modules: ["services.storage"] },
  { id: "CT-033", title: "Warm and cold storage strategy", status: "implemented", modules: ["services.storage"] },
  { id: "CT-034", title: "Project MCP server", status: "implemented", modules: ["services.mcp"] },
  { id: "CT-035", title: "Explicit confirmation for MCP writes", status: "implemented", modules: ["services.mcp"] },
  { id: "CT-036", title: "Per-project backups through UI", status: "implemented", modules: ["services.backup", "services.panel"] },
  { id: "CT-037", title: "Secret and network hardening", status: "implemented", modules: ["services.security"] }
];
