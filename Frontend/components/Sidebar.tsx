import React from 'react';
import { User } from '../types';
import { Icons } from '../constants';
import { TabKey, TAB_PATHS } from '../utils/navigation';
import yggLogo from '../Yggdrasil.png';

const tabs: Array<{ id: TabKey; label: string; icon: React.ComponentType }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Icons.Dashboard },
  { id: 'listeners', label: 'Listeners', icon: Icons.Listeners },
  { id: 'agents', label: 'Agents', icon: Icons.Agents },
  { id: 'credentials', label: 'Credentials', icon: Icons.Credentials },
  { id: 'payloads', label: 'Payloads', icon: Icons.Builder },
  { id: 'files', label: 'File Hosting', icon: Icons.Files },
  { id: 'nmap', label: 'Network Scan', icon: Icons.Nmap },
  { id: 'cli', label: 'Yggdrasil-CLI', icon: Icons.Terminal },
  { id: 'logs', label: 'Audit Logs', icon: Icons.Logs },
  { id: 'settings', label: 'Operators', icon: Icons.Settings },
];

export const Sidebar: React.FC<{
  activeTab: TabKey;
  onNavigate: (tab: TabKey) => void;
  onLogout: () => void;
  currentUser: User;
}> = ({ activeTab, onNavigate, onLogout, currentUser }) => {
  return (
    <div className="w-64 bg-[#0a0a0c] border-r border-white/5 flex flex-col h-full shrink-0">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-10 group cursor-default">
          <div className="w-8 h-8 flex items-center justify-center transition-transform group-hover:rotate-12">
            <img src={yggLogo} alt="Yggdrasil" className="w-8 h-8 object-contain" />
          </div>
          <span className="font-bold tracking-tighter text-2xl text-white">Yggdrasil</span>
        </div>
        <nav className="space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto p-4 border-t border-white/5">
        <div className="px-3 py-2 mb-2 text-[10px] mono text-slate-500 uppercase tracking-widest overflow-hidden truncate">
          User: <span className="text-emerald-500">{currentUser.username}</span>
        </div>
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-rose-500 hover:bg-rose-500/10 transition-all group font-semibold">
          <Icons.Logout />
          TERMINATE SESSION
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
