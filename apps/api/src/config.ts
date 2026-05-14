export type ApiConfig = {
  host: string;
  port: number;
  runnerBaseUrl: string;
  runnerWsUrl: string;
};

export function readConfig(): ApiConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "4000", 10),
    runnerBaseUrl: process.env.RUNNER_BASE_URL ?? "http://localhost:4001",
    runnerWsUrl: process.env.RUNNER_WS_URL ?? "ws://localhost:4001"
  };
}
