/**
 * Fork feature: operator-assisted password reset (reset link written to the
 * server log). Covers the guard rails added when merging upstream:
 * - off unless PAPERCLIP_AUTH_PASSWORD_RESET_LOG_LINKS=true
 * - the logged link ignores the requester's redirectTo
 * - the logged link is built from configuration, never the Host header
 */

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  buildPasswordResetLink,
  createBetterAuthHandler,
  createBetterAuthInstance,
  isPasswordResetLogLinksEnabled,
} from "../auth/better-auth.js";
import { logger } from "../middleware/logger.js";
import type { Config } from "../config.js";

const ORIGIN = "http://127.0.0.1:41998";
const EMAIL = "operator@example.com";
const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-brand-new-password-123";

describe("password reset link helpers", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(isPasswordResetLogLinksEnabled({})).toBe(false);
    expect(isPasswordResetLogLinksEnabled({ PAPERCLIP_AUTH_PASSWORD_RESET_LOG_LINKS: "1" })).toBe(false);
    expect(isPasswordResetLogLinksEnabled({ PAPERCLIP_AUTH_PASSWORD_RESET_LOG_LINKS: "true" })).toBe(true);
  });

  it("builds the link from the configured origin only", () => {
    expect(buildPasswordResetLink("https://pc.example.com/some/path", "tok")).toBe(
      "https://pc.example.com/api/auth/reset-password/tok?callbackURL=https%3A%2F%2Fpc.example.com%2Fauth",
    );
    expect(buildPasswordResetLink(undefined, "tok")).toBe(
      "/api/auth/reset-password/tok?callbackURL=%2Fauth",
    );
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function testConfig(): Config {
  return {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    authBaseUrlMode: "explicit",
    authPublicBaseUrl: ORIGIN,
    authDisableSignUp: false,
    allowedHostnames: ["127.0.0.1"],
    port: 41998,
  } as unknown as Config;
}

function mount(db: ReturnType<typeof createDb>) {
  const app = express();
  app.all("/api/auth/{*authPath}", createBetterAuthHandler(createBetterAuthInstance(db, testConfig(), [ORIGIN])));
  return app;
}

describeEmbeddedPostgres("password reset via logged link", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  const originalEnv = {
    secret: process.env.BETTER_AUTH_SECRET,
    rateLimit: process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED,
    reset: process.env.PAPERCLIP_AUTH_PASSWORD_RESET_LOG_LINKS,
  };

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = "better-auth-secret-for-password-reset-tests";
    process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED = "false";
    delete process.env.PAPERCLIP_AUTH_PASSWORD_RESET_LOG_LINKS;
    database = await startEmbeddedPostgresTestDatabase("paperclip-better-auth-reset-");
    db = createDb(database.connectionString);
  }, 30_000);

  afterAll(async () => {
    await database?.cleanup();
    for (const [key, value] of [
      ["BETTER_AUTH_SECRET", originalEnv.secret],
      ["PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", originalEnv.rateLimit],
      ["PAPERCLIP_AUTH_PASSWORD_RESET_LOG_LINKS", originalEnv.reset],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("rejects reset requests when the feature is not enabled", async () => {
    const app = mount(db);
    const res = await request(app)
      .post("/api/auth/request-password-reset")
      .set("origin", ORIGIN)
      .send({ email: EMAIL, redirectTo: "/auth" });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("RESET_PASSWORD_DISABLED");
  });

  it("resets a password through the logged link and refuses foreign redirects", async () => {
    process.env.PAPERCLIP_AUTH_PASSWORD_RESET_LOG_LINKS = "true";
    const app = mount(db);
    const warn = vi.spyOn(logger, "warn");
    try {
      const signUp = await request(app)
        .post("/api/auth/sign-up/email")
        .set("origin", ORIGIN)
        .send({ email: EMAIL, password: PASSWORD, name: "Operator" });
      expect(signUp.status).toBe(200);

      // Better Auth's own originCheck rejects foreign redirectTo/callbackURL in
      // production but disables itself under a test runner (isTest()), so this
      // suite asserts the stronger property: the logged link never carries the
      // requester's redirectTo or Host, only the configured origin.
      const res = await request(app)
        .post("/api/auth/request-password-reset")
        .set("origin", ORIGIN)
        .set("host", "evil.example")
        .send({ email: EMAIL, redirectTo: "https://evil.example/steal" });
      expect(res.status).toBe(200);

      const line = warn.mock.calls
        .map((call) => call.find((arg) => typeof arg === "string") as string | undefined)
        .find((msg) => msg?.includes("[Password Reset]"));
      expect(line).toBeDefined();
      expect(line).not.toContain("evil.example");
      const match = line!.match(/(https?:\/\/[^\s/]+)\/api\/auth\/reset-password\/([^?\s]+)\?callbackURL=(\S+)/);
      expect(match?.[1]).toBe(ORIGIN);
      expect(decodeURIComponent(match![3]!)).toBe(`${ORIGIN}/auth`);
      const token = decodeURIComponent(match![2]!);

      const callback = await request(app)
        .get(`/api/auth/reset-password/${token}`)
        .query({ callbackURL: `${ORIGIN}/auth` });
      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe(`${ORIGIN}/auth?token=${token}`);

      const reset = await request(app)
        .post("/api/auth/reset-password")
        .set("origin", ORIGIN)
        .send({ newPassword: NEW_PASSWORD, token });
      expect(reset.status).toBe(200);

      const reuse = await request(app)
        .post("/api/auth/reset-password")
        .set("origin", ORIGIN)
        .send({ newPassword: "yet-another-password-1", token });
      expect(reuse.status).toBe(400);

      const oldSignIn = await request(app)
        .post("/api/auth/sign-in/email")
        .set("origin", ORIGIN)
        .send({ email: EMAIL, password: PASSWORD });
      expect(oldSignIn.status).toBe(401);

      const newSignIn = await request(app)
        .post("/api/auth/sign-in/email")
        .set("origin", ORIGIN)
        .send({ email: EMAIL, password: NEW_PASSWORD });
      expect(newSignIn.status).toBe(200);
    } finally {
      warn.mockRestore();
      delete process.env.PAPERCLIP_AUTH_PASSWORD_RESET_LOG_LINKS;
    }
  });
});
