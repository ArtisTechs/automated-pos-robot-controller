import { API_CONFIG } from "./apiConfig";

export interface RobotPositionPayload {
  fromKey: string;
  toKey: string;
  movementJson: string; // seconds-based JSON
}

async function request<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json().catch(() => ({}))) as T;
}

export async function postRobotPosition(payload: RobotPositionPayload) {
  const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.ROBOT_POSITIONS}`;
  return await request(url, {
    method: "POST",
    headers: API_CONFIG.HEADERS,
    body: JSON.stringify(payload),
  });
}

export async function getRobotPositions() {
  const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.ROBOT_POSITIONS}`;
  return await request<any[]>(url, {
    method: "GET",
    headers: API_CONFIG.HEADERS,
  });
}

export async function deleteRobotPosition(params: {
  fromKey: string;
  toKey: string;
}) {
  const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.ROBOT_POSITIONS}`;
  return await request(url, {
    method: "DELETE",
    headers: API_CONFIG.HEADERS,
    body: JSON.stringify(params),
  });
}

export async function getCurrentPosition(): Promise<string> {
  const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.ROBOT_POSITIONS}${API_CONFIG.ENDPOINTS.CURRENT}`;
  const res = await fetch(url, { method: "GET", headers: API_CONFIG.HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export async function updateCurrentPosition(position: string): Promise<void> {
  const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.ROBOT_POSITIONS}${
    API_CONFIG.ENDPOINTS.CURRENT
  }?position=${encodeURIComponent(position)}`;
  const res = await fetch(url, { method: "PUT", headers: API_CONFIG.HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
