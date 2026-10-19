import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3110",
    permissions: ["geolocation"],
    geolocation: { latitude: 37.7749, longitude: -122.4194, accuracy: 5 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } },
    { name: "android-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `${process.execPath} --import tsx tests/e2e-server.ts`,
    url: "http://127.0.0.1:3110/healthz",
    reuseExistingServer: false,
  },
});
