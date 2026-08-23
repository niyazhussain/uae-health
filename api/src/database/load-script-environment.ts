import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

export function loadScriptEnvironment(): void {
  const environmentFile = resolve(process.cwd(), '.env');

  if (existsSync(environmentFile)) {
    loadEnvFile(environmentFile);
  }
}
