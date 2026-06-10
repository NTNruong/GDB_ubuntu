import { describe, expect, it } from "vitest";
import { resolveDockerSocketPath } from "./config.js";

describe("resolveDockerSocketPath", () => {
  it("prefers an explicit DOCKER_SOCKET_PATH", () => {
    expect(
      resolveDockerSocketPath({ DOCKER_SOCKET_PATH: "/custom.sock", DOCKER_HOST: "unix:///run/user/1001/docker.sock" })
    ).toBe("/custom.sock");
  });

  it("honors a unix:// DOCKER_HOST (rootless socket) when no explicit path is set", () => {
    expect(resolveDockerSocketPath({ DOCKER_HOST: "unix:///run/user/1001/docker.sock" })).toBe(
      "/run/user/1001/docker.sock"
    );
  });

  it("ignores a non-unix DOCKER_HOST and falls back to the root socket", () => {
    expect(resolveDockerSocketPath({ DOCKER_HOST: "tcp://127.0.0.1:2375" })).toBe("/var/run/docker.sock");
  });

  it("falls back to the conventional root socket when nothing is set", () => {
    expect(resolveDockerSocketPath({})).toBe("/var/run/docker.sock");
  });
});
