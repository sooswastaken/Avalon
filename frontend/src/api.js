export async function api(path, token, { body, ...options } = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Basic ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `Request failed (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
export const roleImage = (role) =>
  `/images/${role.toLowerCase().replaceAll(" ", "")}.png`;
export const EVIL_ROLES = ["Mordred", "Morgana", "Oberon", "Minion of Mordred"];
export const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};
