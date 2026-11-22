import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the built app in ?demo mode (MemoryStore, no Firebase) at iPhone SE size.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 20_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['iPhone SE'],
    // Chromium stands in for WebKit here; the real check is on the phone.
    browserName: 'chromium',
    launchOptions: { chromiumSandbox: false },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
