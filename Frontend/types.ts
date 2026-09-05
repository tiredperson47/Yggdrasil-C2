export enum AgentStatus {
  ALIVE = 'ALIVE',
  DEAD = 'DEAD',
  IDLE = 'IDLE'
}

export interface Agent {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  status: AgentStatus;
  lastSeen: string;
  notes: string;
  operatingSystem: string;
  profile: string;
  user: string;
  sleep?: number;
  internalIp?: string;
  process?: string;
  pid?: number;
  arch?: string;
}

export interface Listener {
  id: string;
  name: string;
  protocol: string;
  port: number;
  status: 'RUNNING' | 'STOPPED';
  description: string;
  template: string;
  container?: string;
}

export interface ListenerTemplate {
  name: string;
  protocols: string[];
  defaultPort: number;
  description: string;
}

export interface DeployListenerRequest {
  name: string;
  template: string;
  protocol: string;
  port: number;
}

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'operator';
  createdAt: string;
}

export interface CommandLog {
  id: string;
  userId: string;
  username: string;
  agentId: string;
  command: string;
  timestamp: string;
}

export interface HostedFile {
  id: number;
  name: string;
  path: string;
  sizeBytes: number;
  url: string;
  baseUrl: string;
  createdAt?: string;
}

export interface NmapData {
  id: string;
  filename: string;
  uploadDate: string;
  hostCount: number;
  notes: string;
  credentials: string[];
}

export interface Credential {
  id: string;
  type: string;
  username: string;
  secret: string; // The password or secret string
  source: string;
  notes: string;
  timestamp: string;
}

export interface CommandHelp {
  name: string;
  description: string;
  usage: string;
  example: string;
}
