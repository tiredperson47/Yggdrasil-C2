import { Agent, CommandLog, DeployListenerRequest, HostedFile, Listener, ListenerTemplate, User } from './types';

const API_BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // Ignore parse failure.
    }
    throw new Error(message);
  }

  return response.json();
}

async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // Ignore parse failure.
    }
    throw new Error(message);
  }

  return response.json();
}

export const api = {
  login: (username: string, password: string) =>
    request<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<User>('/auth/me'),

  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  register: (username: string, password: string, role: 'admin' | 'operator') =>
    request<{ ok: boolean }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    }),

  fetchUsers: () => request<User[]>('/auth/users'),

  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/auth/users/${id}`, {
      method: 'DELETE',
    }),

  changePassword: (requesterId: number, requesterRole: 'admin' | 'operator', targetUserId: number, newPassword: string) =>
    request<{ ok: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ requesterId, requesterRole, targetUserId, newPassword }),
    }),

  fetchAgents: () => request<Agent[]>('/agents'),

  renameAgent: (id: string, name: string) =>
    request<{ ok: boolean }>(`/agents/${encodeURIComponent(id)}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  updateAgentNotes: (id: string, notes: string) =>
    request<{ ok: boolean }>(`/agents/${encodeURIComponent(id)}/notes`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    }),

  deleteAgent: (id: string, force = false) =>
    request<{ ok: boolean }>(`/agents/${encodeURIComponent(id)}?force=${force}`, {
      method: 'DELETE',
    }),

  fetchAgentHistory: (id: string, limit = 100) =>
    request<{ history: string[] }>(`/agents/${encodeURIComponent(id)}/history?limit=${limit}`),

  sendCommand: (payload: { userId: string; username: string; agentId: string; command: string }) =>
    request<{ log: CommandLog; output: string }>('/commands/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  fetchCommandLogs: () => request<CommandLog[]>('/command-logs'),

  fetchListenerTemplates: () => request<ListenerTemplate[]>('/listeners/templates'),

  fetchActiveListeners: () => request<Listener[]>('/listeners/active'),

  deployListener: (payload: DeployListenerRequest) =>
    request<Listener>('/listeners/deploy', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteListener: (id: string) =>
    request<{ ok: boolean }>(`/listeners/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  uploadFile: (file: File, name?: string, baseUrl?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (name) {
      formData.append('name', name);
    }
    if (baseUrl) {
      formData.append('baseUrl', baseUrl);
    }
    return requestForm<{ ok: boolean; file: HostedFile }>('/files/upload', formData);
  },

  fetchPublicFiles: () => request<HostedFile[]>('/files/public'),

  deletePublicFile: (id: number) =>
    request<{ ok: boolean }>(`/files/public/${id}`, {
      method: 'DELETE',
    }),
};
