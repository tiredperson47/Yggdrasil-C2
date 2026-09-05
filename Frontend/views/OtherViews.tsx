/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-nested-functions, sonarjs/no-nested-template-literals, jsx-a11y/label-has-associated-control */
import React, { useState } from 'react';
import { Agent, CommandLog, Credential, HostedFile, NmapData, User } from '../types';
import { Icons } from '../constants';
import { api } from '../api';
import { formatLocalDateKey, getLocalMinutes, parseTimeInput } from '../utils/time';

export const DashboardView: React.FC<{ agents: Agent[]; listeners: any[]; credentials: Credential[]; commandLogs: CommandLog[]; apiError?: string }> = ({
  agents,
  listeners,
  credentials,
  commandLogs,
  apiError,
}) => (
  <div className="p-10 max-w-7xl mx-auto">
    <h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Command Center</h2>
    <p className="text-slate-500 mono text-xs uppercase tracking-widest mb-12">Yggdrasil Network Status Overview</p>
    {apiError && <p className="text-rose-500 mono text-xs mb-6">API ERROR: {apiError}</p>}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div className="bg-[#111114] p-6 rounded-2xl border border-white/5"><p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Active Implants</p><p className="text-3xl font-bold text-emerald-500">{agents.length}</p></div>
      <div className="bg-[#111114] p-6 rounded-2xl border border-white/5"><p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Endpoints</p><p className="text-3xl font-bold text-sky-500">{listeners.length}</p></div>
      <div className="bg-[#111114] p-6 rounded-2xl border border-white/5"><p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Exfiltrated Creds</p><p className="text-3xl font-bold text-amber-500">{credentials.length}</p></div>
      <div className="bg-[#111114] p-6 rounded-2xl border border-white/5"><p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Tasking Logs</p><p className="text-3xl font-bold text-white">{commandLogs.length}</p></div>
    </div>
  </div>
);

export const CredentialsView: React.FC<{ credentials: Credential[]; onUpdateCreds: (c: Credential[]) => void }> = ({ credentials, onUpdateCreds }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCred, setEditingCred] = useState<Credential | null>(null);
  const [formData, setFormData] = useState({ username: '', secret: '', source: '', notes: '' });

  const resetForm = () => setFormData({ username: '', secret: '', source: '', notes: '' });
  const close = () => { setShowAddModal(false); setEditingCred(null); resetForm(); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCred) {
      onUpdateCreds(credentials.map((c) => (c.id === editingCred.id ? { ...c, ...formData } : c)));
    } else {
      onUpdateCreds([
        {
          id: Math.random().toString(36).slice(2, 11),
          username: formData.username,
          secret: formData.secret,
          type: 'Credential',
          source: formData.source || 'Manual Entry',
          notes: formData.notes,
          timestamp: new Date().toISOString(),
        },
        ...credentials,
      ]);
    }
    close();
  };

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <header className="mb-12 flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Credential Store</h2>
          <p className="text-slate-500 mono text-xs uppercase tracking-widest">Repository of Obtained Authorization Vectors</p>
        </div>
        <button onClick={() => { resetForm(); setEditingCred(null); setShowAddModal(true); }} className="bg-emerald-600 text-white px-8 py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-500/10 hover:bg-emerald-500 transition-all inline-flex items-center gap-2 whitespace-nowrap"><Icons.Plus /> Add Credentials</button>
      </header>

      {(showAddModal || editingCred) && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-[#111114] border border-white/10 p-10 rounded-3xl w-full max-w-xl shadow-2xl">
            <h3 className="text-2xl font-black text-white mb-8 tracking-tighter uppercase">{editingCred ? 'Modify' : 'Add Manual'} Credential</h3>
            <form onSubmit={submit} className="space-y-6">
              <input required value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white mono text-sm" placeholder="Username" />
              <input value={formData.secret} onChange={(e) => setFormData({ ...formData, secret: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white mono text-sm" placeholder="Secret / Password" />
              <input value={formData.source} onChange={(e) => setFormData({ ...formData, source: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white mono text-sm" placeholder="Source (Optional)" />
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="w-full h-24 bg-black border border-white/10 rounded-xl p-4 text-slate-400 mono text-sm resize-none" placeholder="Notes" />
              <div className="flex gap-4 mt-8 pt-6 border-t border-white/5">
                <button type="button" onClick={close} className="flex-1 py-4 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-white transition-all">DISCARD</button>
                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest py-4 rounded-2xl transition-all">{editingCred ? 'SAVE CHANGES' : 'RETAIN CREDENTIAL'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {credentials.map((cred) => (
          <div key={cred.id} className="bg-[#111114] border border-white/5 rounded-2xl p-6 relative overflow-hidden group">
            <div className="flex justify-between items-start mb-6">
              <span className="text-[9px] font-black px-2 py-1 rounded bg-sky-500/10 text-sky-500 uppercase tracking-widest">{cred.type}</span>
              <div className="flex gap-2">
                <button onClick={() => { setEditingCred(cred); setFormData({ username: cred.username, secret: cred.secret, source: cred.source, notes: cred.notes }); }} className="p-1 hover:text-sky-500 text-slate-600 transition-colors"><Icons.Edit /></button>
                <button onClick={() => onUpdateCreds(credentials.filter((c) => c.id !== cred.id))} className="p-1 hover:text-rose-500 text-slate-600 transition-colors"><Icons.Delete /></button>
              </div>
            </div>
            <h4 className="text-lg font-bold text-white mb-1">{cred.username}</h4>
            {cred.secret && <div className="bg-black/40 p-3 rounded-lg border border-white/5 mb-4"><code className="text-emerald-500 text-xs break-all">{cred.secret}</code></div>}
            <div className="space-y-1.5 text-[10px] mono"><div className="flex justify-between"><span className="text-slate-600 uppercase font-bold">Source</span><span className="text-slate-400">{cred.source}</span></div><div className="flex justify-between"><span className="text-slate-600 uppercase font-bold">Obtained</span><span className="text-slate-400">{new Date(cred.timestamp).toLocaleDateString()}</span></div></div>
            {cred.notes && <div className="mt-4 pt-4 border-t border-white/5"><p className="text-[10px] text-slate-500 italic">"{cred.notes}"</p></div>}
          </div>
        ))}
      </div>
    </div>
  );
};

export const FileHostingView: React.FC<{ files: HostedFile[]; onFilesUpdate: (f: HostedFile[]) => void; onDeleteFile: (id: number) => Promise<void> }> = ({ files, onFilesUpdate, onDeleteFile }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const defaultBaseUrl = (import.meta as any).env?.VITE_FILE_HOST_URL || '';
  const [configData, setConfigData] = useState<{ hostAs: string; baseUrl: string }>({ hostAs: '', baseUrl: defaultBaseUrl });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setConfigData({ hostAs: file.name, baseUrl: defaultBaseUrl });
    setShowConfigModal(true);
  };

  const handleConfirmHosting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFile) return;
    if (!configData.baseUrl.trim()) return alert('Base URL is required.');
    try {
      const result = await api.uploadFile(pendingFile, configData.hostAs, configData.baseUrl.trim());
      if (result?.file) onFilesUpdate([result.file, ...files]);
    } catch (error) {
      alert((error as Error).message);
      return;
    }
    setShowConfigModal(false);
    setPendingFile(null);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this hosted file from the registry?')) return;
    try {
      await onDeleteFile(id);
      onFilesUpdate(files.filter((file) => file.id !== id));
    } catch (error) {
      alert((error as Error).message);
    }
  };

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <header className="mb-12 flex justify-between items-end">
        <div><h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Hosted Deliverables</h2><p className="text-slate-500 mono text-xs uppercase tracking-widest">Public Asset Repository</p></div>
        <button onClick={() => fileInputRef.current?.click()} className="bg-white text-black px-8 py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest">UPLOAD ASSET</button>
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
      </header>
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-[#111114] border border-white/10 p-10 rounded-3xl w-full max-w-xl shadow-2xl">
            <h3 className="text-2xl font-black text-white mb-8 tracking-tighter uppercase">Configure Hosting</h3>
            <form onSubmit={handleConfirmHosting} className="space-y-6">
              <input required type="text" value={configData.hostAs} onChange={(e) => setConfigData({ ...configData, hostAs: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none mono text-sm" placeholder="e.g. beacon.exe" />
              <input required type="text" value={configData.baseUrl} onChange={(e) => setConfigData({ ...configData, baseUrl: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none mono text-sm" placeholder="https://files.example.com" />
              <div className="flex gap-4 pt-4"><button type="button" onClick={() => setShowConfigModal(false)} className="flex-1 py-4 text-slate-500 font-black text-[10px] uppercase tracking-widest">CANCEL</button><button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest py-4 rounded-2xl">PUBLISH ASSET</button></div>
            </form>
          </div>
        </div>
      )}
      <div className="bg-[#111114] rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
        <table className="w-full text-left">
          <thead className="bg-white/5 border-b border-white/5"><tr><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase">Asset Name</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase">URL</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase">Size</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase">Actions</th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {files.map((file) => {
              const sizeKb = file.sizeBytes / 1024;
              const sizeLabel = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb.toFixed(1)} KB`;
              return <tr key={file.id} className="hover:bg-white/5"><td className="px-8 py-4 font-bold text-white">{file.name}</td><td className="px-8 py-4 text-emerald-500 text-xs">{file.url}</td><td className="px-8 py-4 text-slate-500 text-xs mono">{sizeLabel}</td><td className="px-8 py-4"><button type="button" onClick={() => void handleDelete(file.id)} className="text-slate-500 hover:text-rose-500"><Icons.Delete /></button></td></tr>;
            })}
            {files.length === 0 && <tr><td colSpan={4} className="px-8 py-10 text-center text-slate-700 italic">No files hosted.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const NmapView: React.FC = () => {
  const [data, setData] = useState<NmapData[]>([]);
  return (
    <div className="p-10 max-w-7xl mx-auto">
      <header className="mb-12 flex justify-between items-end">
        <div><h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Network Recon</h2><p className="text-slate-500 mono text-xs uppercase tracking-widest">Nmap XML Analysis & Storage</p></div>
        <button onClick={() => setData([{ id: 'n1', filename: 'internal_scan.xml', uploadDate: new Date().toISOString(), hostCount: 15, notes: 'Found open SSH on .12', credentials: [] }])} className="bg-sky-600 text-white px-8 py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest">IMPORT XML</button>
      </header>
      {data.length === 0 ? <div className="bg-[#111114] p-12 rounded-3xl border border-dashed border-white/10 text-center text-slate-500 uppercase font-black text-[10px] tracking-widest">Awaiting XML Import...</div> : <div className="grid grid-cols-1 gap-6">{data.map((n) => <div key={n.id} className="bg-[#111114] p-8 rounded-3xl border border-white/5 shadow-2xl"><div className="flex justify-between mb-4"><h4 className="text-white font-bold">{n.filename}</h4><span className="text-slate-500 text-xs mono">{n.uploadDate}</span></div><p className="text-emerald-500 mono text-xs mb-4">Hosts Discovered: {n.hostCount}</p><textarea value={n.notes} readOnly className="w-full bg-black/50 p-4 rounded-xl text-slate-400 mono text-xs h-24 border border-white/5 resize-none" /></div>)}</div>}
    </div>
  );
};

export const ManagementView: React.FC<{ users: User[]; onUpdateUsers: (u: User[]) => void; currentUser: User }> = ({ users, onUpdateUsers, currentUser }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ username: '', password: '', passwordConfirm: '', role: 'operator' as 'operator' | 'admin' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.passwordConfirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.register(formData.username, formData.password, formData.role);
      onUpdateUsers(await api.fetchUsers());
      setShowCreateModal(false);
      setFormData({ username: '', password: '', passwordConfirm: '', role: 'operator' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const deleteUserHandler = async (id: number) => {
    if (id === currentUser.id) return alert('Cannot terminate own session.');
    if (!confirm('Revoke operational access for this user?')) return;
    try {
      await api.deleteUser(id);
      onUpdateUsers(await api.fetchUsers());
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForPassword) return;
    setPasswordError('');
    try {
      await api.changePassword(currentUser.id, currentUser.role, selectedUserForPassword.id, newPassword);
      alert('Password changed successfully');
      setShowPasswordModal(false);
      setNewPassword('');
      setSelectedUserForPassword(null);
    } catch (err) {
      setPasswordError((err as Error).message);
    }
  };

  const openPasswordModal = (user: User) => {
    setSelectedUserForPassword(user);
    setNewPassword('');
    setPasswordError('');
    setShowPasswordModal(true);
  };

  const canManageAllUsers = currentUser.role === 'admin';
  const ownAccount = users.find((u) => u.id === currentUser.id) || currentUser;

  if (!canManageAllUsers) {
    return (
      <div className="p-10 max-w-4xl mx-auto">
        <header className="mb-12"><h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Operators</h2><p className="text-slate-500 mono text-xs uppercase tracking-widest">Self-service password management</p></header>
        <div className="bg-[#111114] rounded-3xl border border-white/5 overflow-hidden shadow-2xl p-8">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div><p className="text-slate-500 text-xs uppercase tracking-widest mb-2">Current Operator</p><h3 className="text-2xl font-bold text-white">{ownAccount.username}</h3><p className="text-slate-500 mono text-xs mt-1">Role: {ownAccount.role}</p></div>
            <button onClick={() => openPasswordModal(ownAccount)} className="bg-sky-600 hover:bg-sky-500 text-white font-black text-[10px] uppercase tracking-widest py-3 px-6 rounded-2xl shadow-lg transition-all">Change My Password</button>
          </div>
        </div>
        {showPasswordModal && selectedUserForPassword && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-6">
            <div className="bg-[#111114] border border-white/10 p-10 rounded-3xl w-full max-w-xl shadow-2xl">
              <h3 className="text-2xl font-black text-white mb-8 tracking-tighter uppercase">Change Password</h3>
              <p className="text-slate-400 text-sm mb-6">Updating password for <span className="text-emerald-500 font-bold">{selectedUserForPassword.username}</span></p>
              <form onSubmit={handleChangePassword} className="space-y-6">
                <div><label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">New Password</label><input required type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:ring-1 focus:ring-sky-500/50 mono text-sm" placeholder="••••••••" /><p className="text-slate-500 text-xs mt-2">Requirements: 10+ chars, uppercase, lowercase, number, special char</p></div>
                {passwordError && <p className="text-rose-500 text-xs italic">{passwordError}</p>}
                <div className="flex gap-4 mt-8 pt-6 border-t border-white/5"><button type="button" onClick={() => { setShowPasswordModal(false); setSelectedUserForPassword(null); setNewPassword(''); setPasswordError(''); }} className="flex-1 py-4 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-white transition-all">CANCEL</button><button type="submit" className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-black text-[10px] uppercase tracking-widest py-4 rounded-2xl shadow-lg transition-all">UPDATE PASSWORD</button></div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <header className="mb-12 flex justify-between items-end">
        <div><h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Operational Management</h2><p className="text-slate-500 mono text-xs uppercase tracking-widest">Operator Authorization & Access Control</p></div>
        <button onClick={() => setShowCreateModal(true)} className="bg-emerald-600 text-white px-8 py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-500/10 hover:bg-emerald-500 transition-all inline-flex items-center gap-2 whitespace-nowrap"><Icons.Plus /> New Operator</button>
      </header>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-[#111114] border border-white/10 p-10 rounded-3xl w-full max-w-xl shadow-2xl">
            <h3 className="text-2xl font-black text-white mb-8 tracking-tighter uppercase">Provision New Operator</h3>
            <form onSubmit={handleCreateUser} className="space-y-6">
              <input required type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 mono text-sm" placeholder="operator_prime" />
              <input required type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 mono text-sm" placeholder="••••••••" />
              <input required type="password" value={formData.passwordConfirm} onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 mono text-sm" placeholder="••••••••" />
              <select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as 'operator' | 'admin' })} className="w-full bg-black border border-white/10 rounded-xl p-4 text-slate-400 focus:outline-none mono text-sm"><option value="operator">Operator (Standard)</option><option value="admin">Administrator (Full Access)</option></select>
              {error && <p className="text-rose-500 text-xs italic">{error}</p>}
              <div className="flex gap-4 mt-8 pt-6 border-t border-white/5"><button type="button" onClick={() => { setShowCreateModal(false); setError(''); }} className="flex-1 py-4 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-white transition-all">ABORT</button><button type="submit" disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-[10px] uppercase tracking-widest py-4 rounded-2xl shadow-lg transition-all">{loading ? 'CREATING...' : 'COMMIT USER'}</button></div>
            </form>
          </div>
        </div>
      )}

      {showPasswordModal && selectedUserForPassword && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-[#111114] border border-white/10 p-10 rounded-3xl w-full max-w-xl shadow-2xl">
            <h3 className="text-2xl font-black text-white mb-8 tracking-tighter uppercase">Change Password</h3>
            <p className="text-slate-400 text-sm mb-6">Updating password for <span className="text-emerald-500 font-bold">{selectedUserForPassword.username}</span></p>
            <form onSubmit={handleChangePassword} className="space-y-6">
              <div><label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">New Password</label><input required type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:ring-1 focus:ring-sky-500/50 mono text-sm" placeholder="••••••••" /><p className="text-slate-500 text-xs mt-2">Requirements: 10+ chars, uppercase, lowercase, number, special char</p></div>
              {passwordError && <p className="text-rose-500 text-xs italic">{passwordError}</p>}
              <div className="flex gap-4 mt-8 pt-6 border-t border-white/5"><button type="button" onClick={() => { setShowPasswordModal(false); setSelectedUserForPassword(null); setNewPassword(''); setPasswordError(''); }} className="flex-1 py-4 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-white transition-all">CANCEL</button><button type="submit" className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-black text-[10px] uppercase tracking-widest py-4 rounded-2xl shadow-lg transition-all">UPDATE PASSWORD</button></div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-[#111114] rounded-3xl border border-white/5 overflow-hidden shadow-2xl mb-12">
        <table className="w-full text-left">
          <thead className="bg-white/5 border-b border-white/5"><tr><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Operator</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Role</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Provisioned</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Actions</th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-white/5 transition-colors">
                <td className="px-8 py-4 font-bold text-white">{u.username}</td>
                <td className="px-8 py-4"><span className={`text-[9px] font-black px-2 py-1 rounded tracking-widest uppercase ${u.role === 'admin' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-sky-500/10 text-sky-500'}`}>{u.role}</span></td>
                <td className="px-8 py-4 text-slate-500 mono text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-8 py-4 flex gap-2"><button onClick={() => openPasswordModal(u)} className="p-2 transition-colors text-slate-500 hover:text-sky-500" title="Change password"><Icons.Settings /></button><button onClick={() => deleteUserHandler(u.id)} className={`p-2 transition-colors ${u.id === currentUser.id ? 'text-slate-700 cursor-not-allowed' : 'text-slate-500 hover:text-rose-500'}`} disabled={u.id === currentUser.id}><Icons.Delete /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const AuditLogsView: React.FC<{ logs: CommandLog[]; agents: Agent[]; filterProps: any }> = ({ logs, agents, filterProps }) => {
  const { filterUser, setFilterUser, filterCommand, setFilterCommand, filterAgentId, setFilterAgentId, filterStart, setFilterStart, filterEnd, setFilterEnd, filterTimeStart, setFilterTimeStart, filterTimeEnd, setFilterTimeEnd, showTargetPopup, setShowTargetPopup } = filterProps;

  const filteredLogs = logs.filter((log) => {
    const matchesUser = filterUser ? log.username.toLowerCase().includes(filterUser.toLowerCase()) : true;
    const matchesCmd = filterCommand ? log.command.toLowerCase().includes(filterCommand.toLowerCase()) : true;
    const matchesAgent = filterAgentId ? log.agentId === filterAgentId : true;
    let matchesDate = true;
    let matchesDailyTime = true;
    const logDate = new Date(log.timestamp);
    if (Number.isNaN(logDate.getTime())) return false;
    const logDay = formatLocalDateKey(logDate);
    if (filterStart && logDay < filterStart) matchesDate = false;
    if (filterEnd && logDay > filterEnd) matchesDate = false;
    const startMinutes = parseTimeInput(filterTimeStart);
    const endMinutes = parseTimeInput(filterTimeEnd);
    if (startMinutes !== null || endMinutes !== null) {
      const currentMinutes = getLocalMinutes(logDate);
      if (startMinutes !== null && endMinutes !== null) {
        matchesDailyTime = startMinutes <= endMinutes ? currentMinutes >= startMinutes && currentMinutes <= endMinutes : currentMinutes >= startMinutes || currentMinutes <= endMinutes;
      } else if (startMinutes !== null) {
        matchesDailyTime = currentMinutes >= startMinutes;
      } else if (endMinutes !== null) {
        matchesDailyTime = currentMinutes <= endMinutes;
      }
    }
    return matchesUser && matchesCmd && matchesDate && matchesDailyTime && matchesAgent;
  });

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Operator', 'AgentID', 'Command'];
    const rows = filteredLogs.map((l) => [l.timestamp, l.username, l.agentId, l.command]);
    const csvContent = `data:text/csv;charset=utf-8,${headers.join(',')}\n${rows.map((e) => e.join(',')).join('\n')}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ygg_audit_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <header className="mb-12 flex justify-between items-end"><div><h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Audit Logs</h2><p className="text-slate-500 mono text-xs uppercase tracking-widest">Immutable Record of Mission Activity</p></div><button onClick={exportToCSV} className="bg-white/5 border border-white/10 hover:bg-white/10 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2">Export CSV</button></header>
      <div className="bg-[#111114] p-6 rounded-2xl border border-white/5 mb-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-4 items-end">
        <input type="text" value={filterUser} onChange={(e) => setFilterUser(e.target.value)} placeholder="Operator" className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
        <input type="text" value={filterCommand} onChange={(e) => setFilterCommand(e.target.value)} placeholder="Instruction" className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
        <div className="relative"><button onClick={() => setShowTargetPopup(!showTargetPopup)} className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-left text-white flex justify-between items-center hover:border-white/20 transition-all">{filterAgentId ? agents.find((a) => a.id === filterAgentId)?.name || filterAgentId : 'All Agents'} <Icons.Search /></button>{showTargetPopup && <div className="absolute top-full left-0 mt-2 w-full bg-[#1a1a1e] border border-white/10 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto custom-scrollbar"><button onClick={() => { setFilterAgentId(''); setShowTargetPopup(false); }} className="w-full text-left px-4 py-2.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white transition-colors">Clear Filter</button>{agents.map((a) => <button key={a.id} onClick={() => { setFilterAgentId(a.id); setShowTargetPopup(false); }} className="w-full text-left px-4 py-2.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white transition-colors flex flex-col"><span className="font-bold">{a.name}</span><span className="text-[10px] opacity-50 mono">{a.id}</span></button>)}</div>}</div>
        <input type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none [color-scheme:dark]" />
        <input type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none [color-scheme:dark]" />
        <input type="time" value={filterTimeStart} onChange={(e) => setFilterTimeStart(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none [color-scheme:dark]" />
        <input type="time" value={filterTimeEnd} onChange={(e) => setFilterTimeEnd(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none [color-scheme:dark]" />
      </div>
      <div className="bg-[#111114] rounded-3xl border border-white/5 overflow-hidden shadow-2xl flex flex-col h-[600px]">
        <div className="overflow-y-auto custom-scrollbar flex-1">
          <table className="w-full text-left"><thead className="bg-white/5 border-b border-white/5 sticky top-0"><tr><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Timestamp</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Operator</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Target Agent</th><th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Instruction</th></tr></thead><tbody className="divide-y divide-white/5 mono text-xs">{filteredLogs.map((log) => <tr key={log.id} className="hover:bg-white/5 transition-colors"><td className="px-8 py-4 text-slate-500">{new Date(log.timestamp).toLocaleString()}</td><td className="px-8 py-4 text-emerald-500 font-bold">{log.username}</td><td className="px-8 py-4 text-slate-400">{agents.find((a) => a.id === log.agentId)?.name || log.agentId}</td><td className="px-8 py-4 text-slate-200">{log.command}</td></tr>)}{filteredLogs.length === 0 && <tr><td colSpan={4} className="px-8 py-10 text-center text-slate-700 italic">No records found matching current criteria.</td></tr>}</tbody></table>
        </div>
      </div>
    </div>
  );
};

export default {
  DashboardView,
  CredentialsView,
  FileHostingView,
  NmapView,
  ManagementView,
  AuditLogsView,
};
