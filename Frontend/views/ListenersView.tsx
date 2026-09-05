import React, { useEffect, useRef, useState } from 'react';
import { Listener, ListenerTemplate } from '../types';
import { Icons } from '../constants';
import { api } from '../api';
import ouroborosLogo from '../Ouroboros.png';

export const ListenersView: React.FC<{ listeners: Listener[]; onUpdateListeners: (l: Listener[]) => void }> = ({ listeners, onUpdateListeners }) => {
  const [showModal, setShowModal] = useState(false);
  const [templates, setTemplates] = useState<ListenerTemplate[]>([]);
  const [formData, setFormData] = useState({ name: '', template: '', protocol: '', port: '' });
  const [listenerBanner, setListenerBanner] = useState<{ type: 'loading' | 'error'; message: string } | null>(null);
  const deployPollRef = useRef<number | null>(null);
  const selectedTemplate = templates.find((t) => t.name === formData.template) || null;

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const data = await api.fetchListenerTemplates();
        setTemplates(data);
        if (data.length > 0) {
          const first = data[0];
          setFormData({
            name: first.name,
            template: first.name,
            protocol: first.protocols[0] || '',
            port: String(first.defaultPort || ''),
          });
        }
      } catch {
        // Ignore errors; UI will show empty selector
      }
    };
    void loadTemplates();
  }, []);

  const handleTemplateChange = (value: string) => {
    const template = templates.find((t) => t.name === value);
    if (!template) {
      setFormData({ ...formData, template: value, protocol: '', port: '' });
      return;
    }
    setFormData({
      ...formData,
      name: formData.name || template.name,
      template: template.name,
      protocol: template.protocols[0] || '',
      port: String(template.defaultPort || ''),
    });
  };

  const showBanner = (type: 'loading' | 'error', message: string) => {
    setListenerBanner({ type, message });
  };

  const clearDeployPoll = () => {
    if (deployPollRef.current !== null) {
      globalThis.clearInterval(deployPollRef.current);
      deployPollRef.current = null;
    }
  };

  const pollForListener = async (target: { name: string; template: string; protocol: string; port: number }) => {
    try {
      const active = await api.fetchActiveListeners();
      onUpdateListeners(active);
      const found = active.some((l) => l.name === target.name && l.template === target.template && l.protocol === target.protocol && l.port === target.port);
      if (found) {
        setListenerBanner(null);
        clearDeployPoll();
      } else {
        showBanner('loading', 'Waiting for listener to become active...');
      }
    } catch {
      showBanner('loading', 'Waiting for listener to become active...');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowModal(false);
    const target = {
      name: formData.name.trim() || formData.template,
      template: formData.template,
      protocol: formData.protocol,
      port: Number.parseInt(formData.port, 10),
    };
    showBanner('loading', 'Deploying listener...');
    clearDeployPoll();
    deployPollRef.current = globalThis.setInterval(() => void pollForListener(target), 20000);
    void pollForListener(target);
    api.deployListener({
      name: target.name,
      template: target.template,
      protocol: target.protocol,
      port: target.port,
    }).catch((error) => {
      const message = (error as Error).message || '';
      const lowered = message.toLowerCase();
      if (lowered.includes('timeout') || lowered.includes('context deadline exceeded')) return;
      showBanner('error', message);
      clearDeployPoll();
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Destroy this listener container?')) return;
    try {
      await api.deleteListener(id);
      const active = await api.fetchActiveListeners();
      onUpdateListeners(active);
    } catch (error) {
      showBanner('error', (error as Error).message);
    }
  };

  useEffect(() => () => clearDeployPoll(), []);

  return (
    <div className="p-10 max-w-7xl mx-auto">
      {listenerBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[300]">
          <div
            className={`flex items-center gap-3 px-6 py-3 rounded-2xl shadow-2xl border backdrop-blur-md animate-in slide-in-from-top-3 duration-300 ${
              listenerBanner.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-black/60 border-white/10 text-slate-200'
            }`}
          >
            {listenerBanner.type === 'loading' && (
              <img src={ouroborosLogo} alt="Deploying" className="w-8 h-8 object-contain animate-spin" />
            )}
            <span className="text-xs uppercase tracking-widest font-bold">{listenerBanner.message}</span>
          </div>
        </div>
      )}
      <header className="mb-12 flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Listeners</h2>
          <p className="text-slate-500 mono text-xs uppercase tracking-widest">Management of Callback Endpoints</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-emerald-500 transition-all">
          <Icons.Plus /> New Listener
        </button>
      </header>

      {showModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-[#111114] border border-white/10 p-10 rounded-3xl w-full max-w-xl shadow-2xl">
            <h3 className="text-2xl font-black text-white mb-8 tracking-tighter uppercase">Initialize Service</h3>
            <form onSubmit={handleCreate} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Listener Name</label>
                <input required type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none mono text-sm" placeholder="team-http" />
                <p className="text-[10px] text-slate-500 mt-2 uppercase tracking-widest">Docker container: ygg-listener-&lt;name&gt;</p>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Listener Type</label>
                <select required value={formData.template} onChange={(e) => handleTemplateChange(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-4 text-slate-400 focus:outline-none mono text-sm">
                  {templates.length === 0 && <option value="">No listener templates found</option>}
                  {templates.map((template) => <option key={template.name} value={template.name}>{template.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Protocol</label>
                  <select required value={formData.protocol} onChange={(e) => setFormData({ ...formData, protocol: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-slate-400 focus:outline-none mono text-sm">
                    {selectedTemplate?.protocols.map((proto) => <option key={proto} value={proto}>{proto}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Port</label>
                  <input required type="number" value={formData.port} onChange={(e) => setFormData({ ...formData, port: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none mono text-sm" placeholder="80" />
                </div>
              </div>
              {selectedTemplate && (
                <div className="bg-black/50 border border-white/10 rounded-xl p-4 text-slate-400 text-xs">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Description</p>
                  <p className="text-slate-300">{selectedTemplate.description || 'No description provided.'}</p>
                </div>
              )}
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-4 text-slate-500 font-black text-[10px] uppercase tracking-widest">CANCEL</button>
                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest py-4 rounded-2xl">INITIALIZE</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-[#111114] rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
        <table className="w-full text-left">
          <thead className="bg-white/5 border-b border-white/5">
            <tr>
              <th className="px-6 py-5 text-[10px] font-bold text-slate-500 uppercase">Name</th>
              <th className="px-6 py-5 text-[10px] font-bold text-slate-500 uppercase">Protocol</th>
              <th className="px-6 py-5 text-[10px] font-bold text-slate-500 uppercase">Port</th>
              <th className="px-6 py-5 text-[10px] font-bold text-slate-500 uppercase">Status</th>
              <th className="px-6 py-5 text-[10px] font-bold text-slate-500 uppercase">Details</th>
              <th className="px-6 py-5 text-[10px] font-bold text-slate-500 uppercase text-right">Delete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {listeners.map((l) => (
              <tr key={l.id} className="hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 font-bold text-white text-sm">{l.name}</td>
                <td className="px-6 py-4 text-sky-400 font-mono text-xs">{l.protocol}</td>
                <td className="px-6 py-4 text-slate-400 font-mono text-xs">{l.port}</td>
                <td className="px-6 py-4"><span className="text-[10px] font-black px-2 py-1 rounded tracking-widest bg-emerald-500/10 text-emerald-500">{l.status}</span></td>
                <td className="px-6 py-4">
                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer hover:text-white">Details</summary>
                    <div className="mt-2 space-y-1">
                      <div><span className="text-slate-500">Template:</span> {l.template}</div>
                      <div><span className="text-slate-500">Protocol:</span> {l.protocol}</div>
                      <div><span className="text-slate-500">Port:</span> {l.port}</div>
                      <div><span className="text-slate-500">Description:</span> {l.description || 'No description provided.'}</div>
                    </div>
                  </details>
                </td>
                <td className="px-6 py-4 text-right">
                  <button type="button" onClick={() => void handleDelete(l.id)} className="text-slate-500 hover:text-rose-500" title="Destroy listener">
                    <Icons.Delete />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ListenersView;
