import { defineConfig, devices } from '@playwright/test';

// Sign-in and sync against the Firebase emulators. Run with `npm run test:e2e:emu`,
// which starts the emulators around this.
export default defineConfig({
  testDir: 'tests/e2e-emulator',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    ...devices['iPhone SE'],
    browserName: 'chromium',
    launchOptions: { chromiumSandbox: false },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --mode emulator --port 5174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
  },
});
