/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Must match runtime VAI_OWNER_EMAIL for owner UI. */
  readonly VITE_VAI_OWNER_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
