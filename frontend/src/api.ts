import type { DashboardResponse } from "./types";

export async function fetchDashboard(): Promise<DashboardResponse> {
  const response = await fetch("/api/v2/dashboard", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Dashboard API returned ${response.status}`);
  }
  return response.json() as Promise<DashboardResponse>;
}

