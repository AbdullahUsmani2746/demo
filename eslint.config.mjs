import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// ESLint's cache (used by `next lint` and `next build`) has to serialise every
// config; a parser without `meta` (next's bundled babel parser) cannot be, and
// the run fails with "Cannot serialize key 'parse' in 'parser'". Name it.
const withParserMeta = (config) => {
  const parser = config.languageOptions?.parser;
  if (!parser || parser.meta) return config;
  return { ...config, languageOptions: { ...config.languageOptions, parser: { ...parser, meta: { name: "eslint-config-next/parser", version: "1" } } } };
};

const eslintConfig = compat.extends("next/core-web-vitals").map(withParserMeta);

export default eslintConfig;
