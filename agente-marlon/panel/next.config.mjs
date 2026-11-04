import path from "node:path";
import { fileURLToPath } from "node:url";

/** O painel conversa com o backend pelo mesmo domínio (cookies httpOnly), via rewrite. */
const backend = process.env.BACKEND_URL ?? "http://localhost:3333";
const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  // A raiz do painel é esta pasta (não a do backend), para não vigiar o node_modules do backend.
  turbopack: { root: here },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
