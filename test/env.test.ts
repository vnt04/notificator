import { describe, it, expect } from "vitest";
import { loadEnv } from "../src/config/env.js";

describe("loadEnv", () => {
  it("returns defaults for a minimal source", () => {
    const env = loadEnv({});

    expect(env.PORT).toBe(3000);
    expect(env.SYMBOLS).toEqual(["btcusdt", "ethusdt"]);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("throws when PORT is invalid", () => {
    expect(() => loadEnv({ PORT: "abc" })).toThrow();
  });

  it("does not throw when DISCORD_WEBHOOK_URL is missing", () => {
    expect(() => loadEnv({})).not.toThrow();
  });

  it("treats an empty DISCORD_WEBHOOK_URL as absent (matches .env.example)", () => {
    const env = loadEnv({ DISCORD_WEBHOOK_URL: "" });

    expect(env.DISCORD_WEBHOOK_URL).toBeUndefined();
  });

  it("accepts a valid DISCORD_WEBHOOK_URL", () => {
    const url = "https://discord.com/api/webhooks/123/abc";
    const env = loadEnv({ DISCORD_WEBHOOK_URL: url });

    expect(env.DISCORD_WEBHOOK_URL).toBe(url);
  });

  it("throws when DISCORD_WEBHOOK_URL is a non-empty invalid url", () => {
    expect(() => loadEnv({ DISCORD_WEBHOOK_URL: "not-a-url" })).toThrow();
  });
});
