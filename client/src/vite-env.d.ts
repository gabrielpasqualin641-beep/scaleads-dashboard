/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL pública do backend quando front e API vivem em domínios separados. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
