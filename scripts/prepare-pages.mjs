import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(process.cwd());
const redirectConfig = resolve(projectRoot, '.wrangler', 'deploy', 'config.json');

if (!redirectConfig.startsWith(`${projectRoot}\\`) && !redirectConfig.startsWith(`${projectRoot}/`)) {
  throw new Error('Refusing to clean a path outside the project');
}

if (existsSync(redirectConfig)) rmSync(redirectConfig);
