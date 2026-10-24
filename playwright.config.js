import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';

// Chromium préinstallé : CHROMIUM_PATH, sinon le premier chromium trouvé dans PLAYWRIGHT_BROWSERS_PATH (aucun téléchargement).
function localChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().at(-1);
  const bin = dir && `${root}/${dir}/chrome-linux64/chrome`;
  return bin && existsSync(bin) ? bin : undefined;
}
const executablePath = localChromium();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', timezoneId: 'Europe/Paris', locale: 'fr-FR',
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}
  },
  projects: [
    { name: 'bureau', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'telephone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }
  ],
  webServer: { command: 'npm run dev -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI }
});
