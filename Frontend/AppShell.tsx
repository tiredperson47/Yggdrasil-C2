import React, { useEffect, useState } from 'react';
import { Agent, User, CommandLog, HostedFile, Listener, Credential } from './types';
import { api } from './api';
import Sidebar from './components/Sidebar';
import { getPathFromTab, getTabFromPath, TabKey } from './utils/navigation';
import {
  DashboardView,
  CredentialsView,
  FileHostingView,
  NmapView,
  ManagementView,
  AuditLogsView,
} from './views/OtherViews';
import { PayloadsView } from './views/PayloadsView';
import { AgentsView } from './views/AgentsView';
import { ListenersView } from './views/ListenersView';
import { ConsoleView } from './views/ConsoleView';
import yggLogo from './Yggdrasil.png';

const Login: React.FC<{ onLogin: (user: User) => void }> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onLogin(await api.login(username, password));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050507]">
      <div className="bg-[#111114] p-8 rounded-xl border border-white/5 w-full max-w-md shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/30" />
        <div className="flex flex-col items-center mb-8">
          <div className="w-28 h-28 flex items-center justify-center mb-4">
            <img src={yggLogo} alt="Yggdrasil" className="w-24 h-24 object-contain" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Yggdrasil Core</h1>
          <p className="text-slate-500 text-sm mt-1 uppercase tracking-widest text-[10px]">Secure C2 Framework</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all mono text-sm" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all mono text-sm" />
          {error && <p className="text-rose-500 text-xs mt-2 italic">{error}</p>}
          <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg transition-all mt-4 shadow-lg shadow-emerald-500/10 active:scale-95 text-xs tracking-widest">AUTHORIZE</button>
        </form>
      </div>
    </div>
  );
};

const AppShell: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>(() => getTabFromPath(globalThis.location?.pathname || '/') || 'dashboard');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [listeners, setListeners] = useState<Listener[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [hostedFiles, setHostedFiles] = useState<HostedFile[]>([]);
  const [commandLogs, setCommandLogs] = useState<CommandLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [apiError, setApiError] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterCommand, setFilterCommand] = useState('');
  const [filterAgentId, setFilterAgentId] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterTimeStart, setFilterTimeStart] = useState('');
  const [filterTimeEnd, setFilterTimeEnd] = useState('');
  const [showTargetPopup, setShowTargetPopup] = useState(false);

  useEffect(() => {
    const loadSession = async () => {
      try {
        setCurrentUser(await api.me());
      } catch {
        // no session
      } finally {
        setAuthChecked(true);
      }
    };
    void loadSession();
  }, []);

  useEffect(() => {
    const syncTabFromLocation = () => {
      const tab = getTabFromPath(globalThis.location.pathname);
      if (!tab) {
        globalThis.history.replaceState({}, '', getPathFromTab('dashboard'));
        setActiveTab('dashboard');
        return;
      }
      setActiveTab(tab);
    };
    syncTabFromLocation();
    globalThis.addEventListener('popstate', syncTabFromLocation);
    return () => globalThis.removeEventListener('popstate', syncTabFromLocation);
  }, []);

  const navigateToTab = (tab: TabKey) => {
    const path = getPathFromTab(tab);
    if (globalThis.location.pathname !== path) {
      globalThis.history.pushState({}, '', path);
    }
    setActiveTab(tab);
  };

  const loadAgents = async () => {
    try {
      setAgents(await api.fetchAgents());
      setApiError('');
    } catch (error) {
      setApiError((error as Error).message);
    }
  };

  const loadCommandLogs = async () => {
    try {
      setCommandLogs(await api.fetchCommandLogs());
    } catch {
      // ignore
    }
  };

  const loadUsers = async () => {
    try {
      setUsers(await api.fetchUsers());
    } catch {
      // ignore
    }
  };

  const loadListeners = async () => {
    try {
      setListeners(await api.fetchActiveListeners());
    } catch {
      // ignore
    }
  };

  const loadPublicFiles = async () => {
    try {
      setHostedFiles(await api.fetchPublicFiles());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    void loadAgents();
    void loadCommandLogs();
    void loadUsers();
    void loadListeners();
    void loadPublicFiles();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const stream = new EventSource('/api/agents/stream', { withCredentials: true });
    stream.onmessage = () => { void loadAgents(); };
    stream.onerror = () => stream.close();
    return () => stream.close();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || activeTab !== 'agents') return;
    void loadAgents();
    const timer = globalThis.setInterval(() => void loadAgents(), 5000);
    return () => globalThis.clearInterval(timer);
  }, [currentUser, activeTab]);

  useEffect(() => {
    if (!currentUser || activeTab !== 'listeners') return;
    void loadListeners();
    const timer = globalThis.setInterval(() => void loadListeners(), 20000);
    return () => globalThis.clearInterval(timer);
  }, [currentUser, activeTab]);

  useEffect(() => {
    if (!currentUser || activeTab !== 'logs') return;
    void loadCommandLogs();
  }, [currentUser, activeTab]);

  const sendAgentCommand = async (agentId: string, command: string, user: User) => {
    const result = await api.sendCommand({ userId: String(user.id), username: user.username, agentId, command });
    await loadCommandLogs();
    return result.output || '';
  };

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center bg-[#050507] text-slate-500 text-xs uppercase tracking-widest">Checking session...</div>;
  }

  if (!currentUser) {
    return <Login onLogin={setCurrentUser} />;
  }

  return (
    <div className="flex h-screen bg-[#050507] text-slate-300">
      <Sidebar activeTab={activeTab} onNavigate={navigateToTab} onLogout={async () => { try { await api.logout(); } finally { setCurrentUser(null); } }} currentUser={currentUser} />
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'dashboard' && <DashboardView agents={agents} listeners={listeners} credentials={credentials} commandLogs={commandLogs} apiError={apiError} />}
        {activeTab === 'agents' && (
          <AgentsView
            agents={agents}
            currentUser={currentUser}
            onRefreshAgents={loadAgents}
            onRenameAgent={(id, name) => api.renameAgent(id, name)}
            onDeleteAgent={(id, force) => api.deleteAgent(id, force)}
            onSaveNotes={(id, notes) => api.updateAgentNotes(id, notes)}
            onSendAgentCommand={sendAgentCommand}
            onFetchAgentHistory={async (id) => (await api.fetchAgentHistory(id)).history}
          />
        )}
        {activeTab === 'listeners' && <ListenersView listeners={listeners} onUpdateListeners={setListeners} />}
        {activeTab === 'credentials' && <CredentialsView credentials={credentials} onUpdateCreds={setCredentials} />}
        {activeTab === 'payloads' && <PayloadsView onFileCreated={(f) => setHostedFiles([f, ...hostedFiles])} />}
        {activeTab === 'files' && <FileHostingView files={hostedFiles} onFilesUpdate={setHostedFiles} onDeleteFile={(id) => api.deletePublicFile(id)} />}
        {activeTab === 'nmap' && <NmapView />}
        {activeTab === 'cli' && (
          <ConsoleView
            agents={agents}
            currentUser={currentUser}
            onSendAgentCommand={sendAgentCommand}
            onRenameAgent={(id, name) => api.renameAgent(id, name)}
            onDeleteAgent={(id, force) => api.deleteAgent(id, force)}
            onRefreshAgents={loadAgents}
            onFetchAgentHistory={async (id) => (await api.fetchAgentHistory(id)).history}
            onUpdateAgents={setAgents}
          />
        )}
        {activeTab === 'logs' && <AuditLogsView logs={commandLogs} agents={agents} filterProps={{ filterUser, setFilterUser, filterCommand, setFilterCommand, filterAgentId, setFilterAgentId, filterStart, setFilterStart, filterEnd, setFilterEnd, filterTimeStart, setFilterTimeStart, filterTimeEnd, setFilterTimeEnd, showTargetPopup, setShowTargetPopup }} />}
        {activeTab === 'settings' && <ManagementView users={users} onUpdateUsers={setUsers} currentUser={currentUser} />}
      </main>
    </div>
  );
};

export default AppShell;
