// Generates a synthetic Pages Router app: `pages` routes, each importing
// `perPage` of `components` shared components (each with a CSS module).
// Usage: node scripts/generate.mjs [pages=20] [components=100] [perPage=10]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const [pages = 20, components = 100, perPage = 10] = process.argv.slice(2).map(Number);

rmSync("pages", { recursive: true, force: true });
rmSync("components", { recursive: true, force: true });
mkdirSync("pages/p", { recursive: true });
mkdirSync("components", { recursive: true });

for (let c = 0; c < components; c++) {
  writeFileSync(`components/c${c}.module.css`, `.box { padding: ${c % 16}px; }\n`);
  writeFileSync(
    `components/c${c}.jsx`,
    `import styles from "./c${c}.module.css";
export default function C${c}({ label }) {
  return <div className={styles.box}>component ${c}: {label}</div>;
}
`,
  );
}

function page(name, seed, depth) {
  const ids = Array.from({ length: perPage }, (_, i) => (seed * 7919 + i * 104729) % components);
  const unique = [...new Set(ids)];
  return `${unique.map((id) => `import C${id} from "${depth}components/c${id}.jsx";`).join("\n")}

export default function Page() {
  return (
    <main>
      <h1>${name}</h1>
      ${unique.map((id) => `<C${id} label="${name}" />`).join("\n      ")}
    </main>
  );
}

export function getServerSideProps() {
  return { props: {} };
}
`;
}

writeFileSync(
  "pages/_app.jsx",
  `export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
`,
);
writeFileSync("pages/index.jsx", page("home", 0, "../"));
for (let p = 1; p < pages; p++) writeFileSync(`pages/p/${p}.jsx`, page(`page ${p}`, p, "../../"));

console.log(`generated ${pages} pages, ${components} components, ${perPage} components per page`);
