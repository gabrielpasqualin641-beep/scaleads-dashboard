/** O painel conversa com o backend pelo mesmo domínio (cookies httpOnly), via rewrite. */
const backend = process.env.BACKEND_URL ?? "http://localhost:3333";

export default {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
