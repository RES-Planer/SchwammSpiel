import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

type RootPackageJson = {
  repository?: string;
};

function getRepositoryNameFromPackageJson(): string | undefined {
  const currentFilePath = fileURLToPath(import.meta.url);
  const packageJson = JSON.parse(
    readFileSync(resolve(dirname(currentFilePath), '../../package.json'), 'utf8'),
  ) as RootPackageJson;
  const repository = packageJson.repository;
  if (!repository) {
    return undefined;
  }

  const match = repository.match(/([^/:]+)\/([^/]+)$/);
  return match?.[2];
}

const repositoryName =
  process.env.GITHUB_REPOSITORY?.split('/')[1] ??
  process.env.VITE_REPOSITORY_NAME ??
  getRepositoryNameFromPackageJson();

export default defineConfig({
  base: repositoryName ? `/${repositoryName}/` : '/',
  plugins: [preact()],
});
