import { describe, expect, it, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { resolveRuntimeBind, validateConfiguredBindMode } from "@paperclipai/shared";
import { buildPresetServerConfig } from "../config/server-bind.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("network bind helpers", () => {
  beforeEach(() => {
    // Clear the environment variable to start fresh
    delete process.env.PAPERCLIP_TAILNET_BIND_HOST;
  });

  it("rejects non-loopback bind modes in local_trusted", () => {
    expect(
      validateConfiguredBindMode({
        deploymentMode: "local_trusted",
        deploymentExposure: "private",
        bind: "lan",
        host: "0.0.0.0",
      }),
    ).toContain("local_trusted requires server.bind=loopback");
  });

  it("resolves tailnet bind using the detected tailscale address", () => {
    const resolved = resolveRuntimeBind({
      bind: "tailnet",
      host: "127.0.0.1",
      tailnetBindHost: "100.64.0.8",
    });

    expect(resolved.errors).toEqual([]);
    expect(resolved.host).toBe("100.64.0.8");
  });

  it("requires a custom bind host when bind=custom", () => {
    const resolved = resolveRuntimeBind({
      bind: "custom",
      host: "127.0.0.1",
    });

    expect(resolved.errors).toContain("server.customBindHost is required when server.bind=custom");
  });

  it("stores the detected tailscale address for tailnet presets", () => {
    process.env.PAPERCLIP_TAILNET_BIND_HOST = "100.64.0.8";

    const preset = buildPresetServerConfig("tailnet", {
      port: 3100,
      allowedHostnames: [],
      serveUi: true,
    });

    expect(preset.server.host).toBe("100.64.0.8");

    delete process.env.PAPERCLIP_TAILNET_BIND_HOST;
  });

  it("falls back to loopback when no tailscale address is available for tailnet presets", () => {
    // Mock execFileSync to throw an error, simulating Tailscale not being available
    (execFileSync as any).mockImplementation(() => {
      throw new Error("Tailscale not available");
    });

    const preset = buildPresetServerConfig("tailnet", {
      port: 3100,
      allowedHostnames: [],
      serveUi: true,
    });

    expect(preset.server.host).toBe("127.0.0.1");
  });
});
