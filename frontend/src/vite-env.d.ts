/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Book Vault API, e.g. http://localhost:8000 or /api. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
