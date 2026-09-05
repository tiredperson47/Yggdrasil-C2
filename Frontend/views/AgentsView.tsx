import React, { useEffect, useRef, useState } from 'react';
import { Agent, AgentStatus, User } from '../types';
import { Icons } from '../constants';
import { formatConsoleTimestamp, formatRelativeTime } from '../utils/time';

type AgentViewMode = 'cards' | 'rows';

interface AgentProfileCommandHelp {
  name: string;
  description: string;
  usage: string;
}

interface AgentProfileConfig {
  commands: string[];
  command_descriptions?: Record<string, string>;
  command_usage?: Record<string, string>;
}

interface AgentProfileSummary {
  name: string;
  config: AgentProfileConfig;
}

interface AgentProfilesResponse {
  profiles: AgentProfileSummary[];
}

const getStoredViewMode = (): AgentViewMode => {
  const stored = globalThis.localStorage?.getItem('agentViewMode');
  return stored === 'rows' ? 'rows' : 'cards';
};

const getRowClassName = (selected: boolean, index: number) => {
  if (selected) return 'bg-emerald-500/20 text-white';
  return index % 2 === 0 ? 'bg-[#3f424f] hover:bg-[#4b5571]' : 'bg-[#53648d] hover:bg-[#60739f]';
};

const getStatusClassName = (status: AgentStatus) => {
  if (status === AgentStatus.ALIVE) return 'bg-emerald-500/10 text-emerald-500';
  if (status === AgentStatus.IDLE) return 'bg-amber-500/10 text-amber-500';
  return 'bg-rose-500/10 text-rose-500';
};

const consoleTimestampPattern = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/;

const formatConsoleLine = (line: string) => (consoleTimestampPattern.test(line) ? line : `[${formatConsoleTimestamp()}] ${line}`);

export const AgentsView: React.FC<{
  agents: Agent[];
  currentUser: User;
  onRefreshAgents: () => Promise<void>;
  onRenameAgent: (id: string, name: string) => Promise<void>;
  onDeleteAgent: (id: string, force: boolean) => Promise<void>;
  onSaveNotes: (id: string, notes: string) => Promise<void>;
  onSendAgentCommand: (agentId: string, command: string, user: User) => Promise<string>;
  onFetchAgentHistory: (agentId: string) => Promise<string[]>;
}> = ({ agents, currentUser, onRefreshAgents, onRenameAgent, onDeleteAgent, onSaveNotes, onSendAgentCommand, onFetchAgentHistory }) => {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [agentOutputs, setAgentOutputs] = useState<Record<string, string[]>>({});
  const [inputValue, setInputValue] = useState('');
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [selectedHelpCommand, setSelectedHelpCommand] = useState<string | null>(null);
  const [editingNotesAgentId, setEditingNotesAgentId] = useState<string | null>(null);
  const [tempNotes, setTempNotes] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<AgentViewMode>(getStoredViewMode);
  const [showMassCommandModal, setShowMassCommandModal] = useState(false);
  const [massCommand, setMassCommand] = useState('');
  const [massResults, setMassResults] = useState<Array<{ id: string; name: string; output: string[]; status: 'Success' | 'Failed' }>>([]);
  const [now, setNow] = useState(() => Date.now());
  const [commandHelpByProfile, setCommandHelpByProfile] = useState<Record<string, Record<string, AgentProfileCommandHelp>>>({});
  const terminalBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleOutput]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  useEffect(() => {
    globalThis.localStorage?.setItem('agentViewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    const loadCommandHelp = async () => {
      try {
        const response = await fetch('/api/agent-profiles', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Request failed with HTTP ${response.status}`);
        }

        const data = (await response.json()) as AgentProfilesResponse;
        const nextHelpByProfile = data.profiles.reduce<Record<string, Record<string, AgentProfileCommandHelp>>>((accumulator, profile) => {
          const profileHelp: Record<string, AgentProfileCommandHelp> = {};
          const commands = profile.config?.commands ?? [];

          commands.forEach((command) => {
            const description = profile.config.command_descriptions?.[command]
              ?? profile.config.command_descriptions?.[command.toLowerCase()]
              ?? `${command} is defined by the selected agent profile.`;
            const usage = profile.config.command_usage?.[command]
              ?? profile.config.command_usage?.[command.toLowerCase()]
              ?? `${command} [arguments]`;

            profileHelp[command] = {
              name: command,
              description,
              usage,
            };
          });

          accumulator[profile.name] = profileHelp;
          return accumulator;
        }, {});

        setCommandHelpByProfile(nextHelpByProfile);
      } catch {
        setCommandHelpByProfile({});
      }
    };

    void loadCommandHelp();
  }, []);

  const openAgentConsole = async (agent: Agent) => {
    // Persist previous agent output
    const nextAgentOutputs = selectedAgent
      ? { ...agentOutputs, [selectedAgent.id]: consoleOutput }
      : agentOutputs;
    if (selectedAgent) {
      setAgentOutputs(nextAgentOutputs);
    }

    setSelectedAgent(agent);
    const base = [`Establishing Uplink to Session: ${agent.id}...`, `Target: ${agent.hostname} (${agent.ip})`, 'Shell Ready.'].map(formatConsoleLine);
    // Load saved output if present, otherwise fetch server history
    const saved = nextAgentOutputs[agent.id];
    if (saved) {
      setConsoleOutput([...base, ...saved]);
      return;
    }
    try {
      const history = await onFetchAgentHistory(agent.id);
      setConsoleOutput([...base, ...history]);
    } catch {
      setConsoleOutput([...base, '[WARN]: Unable to pull Redis history for this agent.']);
    }
  };

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = inputValue.trim();
    if (!cmd || !selectedAgent) return;

    if (cmd.toLowerCase() === 'help') {
      setShowHelpModal(true);
      setInputValue('');
      return;
    }

    if (cmd.toLowerCase() === 'clear') {
      const nextOutput = [...consoleOutput, '', formatConsoleLine('--- screen cleared ---'), ''];
      setConsoleOutput(nextOutput);
      if (selectedAgent) {
        setAgentOutputs((prev) => ({ ...prev, [selectedAgent.id]: nextOutput }));
      }
      setInputValue('');
      return;
    }

    setInputValue('');
    setConsoleOutput((prev) => [...prev, formatConsoleLine(`${currentUser.username}@yggdrasil: ${cmd}`), formatConsoleLine(`[SYSTEM]: Sending command to ${selectedAgent.id}...`)]);

    try {
      const output = await onSendAgentCommand(selectedAgent.id, cmd, currentUser);
      const outputLines = output ? output.split('\n').filter(Boolean).map((line) => formatConsoleLine(line)) : [formatConsoleLine('[RESULT]: Success')];
      setConsoleOutput((prev) => [...prev, ...outputLines]);
    } catch (error) {
      setConsoleOutput((prev) => [...prev, formatConsoleLine(`[ERROR]: ${(error as Error).message}`)]);
    }
  };

  const deleteAgent = async (id: string) => {
    if (!confirm('Permanently purge this implant? All traces will be removed from core database.')) return;

    try {
      await onDeleteAgent(id, false);
    } catch (error) {
      const message = (error as Error).message;
      if (message.toLowerCase().includes('force')) {
        const hardDelete = confirm('Agent is ALIVE. Send "exit" and force delete?');
        if (!hardDelete) return;
        try {
          await onDeleteAgent(id, true);
        } catch (forceError) {
          alert((forceError as Error).message);
          return;
        }
      } else {
        alert(message);
        return;
      }
    }

    await onRefreshAgents();
    if (selectedAgent?.id === id) {
      setAgentOutputs((prev) => ({ ...prev, [selectedAgent.id]: consoleOutput }));
      setSelectedAgent(null);
    }
    const nextSelected = new Set(selectedIds);
    nextSelected.delete(id);
    setSelectedIds(nextSelected);
  };

  const renameAgent = async (id: string) => {
    const newName = prompt('New identification label:');
    if (!newName?.trim()) return;
    try {
      await onRenameAgent(id, newName.trim());
      await onRefreshAgents();
      if (selectedAgent?.id === id) setSelectedAgent({ ...selectedAgent, name: newName.trim() });
    } catch (error) {
      alert((error as Error).message);
    }
  };

  const saveNotes = async (id: string) => {
    await onSaveNotes(id, tempNotes);
    await onRefreshAgents();
    setEditingNotesAgentId(null);
  };

  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const nextSelected = new Set(selectedIds);
    if (nextSelected.has(id)) nextSelected.delete(id);
    else nextSelected.add(id);
    setSelectedIds(nextSelected);
  };

  const selectAll = () => {
    setSelectedIds(new Set(agents.map((a) => a.id)));
  };

  const massPurge = async () => {
    if (!confirm(`Purge ${selectedIds.size} selected implants? This action cannot be undone.`)) return;
    for (const id of Array.from(selectedIds)) {
      try {
        await onDeleteAgent(id, false);
      } catch {
        await onDeleteAgent(id, true);
      }
    }
    await onRefreshAgents();
    setSelectedIds(new Set());
  };

  const handleMassCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!massCommand.trim()) return;
    
    // Close modal immediately
    setShowMassCommandModal(false);
    
    const idArray = Array.from(selectedIds) as string[];
    const results: Array<{ id: string; name: string; output: string[]; status: 'Success' | 'Failed' }> = [];
    
    for (const id of idArray) {
      const agent = agents.find((a) => a.id === id);
      try {
        const output = await onSendAgentCommand(id, massCommand, currentUser);
        const outputLines = output ? output.split('\n').filter(Boolean) : [];
        results.push({
          id,
          name: agent?.name || id,
          output: outputLines.length > 0 ? outputLines : ['(no output)'],
          status: output ? 'Success' : 'Failed',
        });
      } catch (error) {
        results.push({
          id,
          name: agent?.name || id,
          output: [`Error: ${(error as Error).message}`],
          status: 'Failed',
        });
      }
    }

    setMassResults(results);
    setMassCommand('');
    setSelectedIds(new Set());
  };

  const selectedProfileHelp = selectedAgent ? commandHelpByProfile[selectedAgent.profile] ?? {} : {};
  const selectedProfileHelpKeys = Object.keys(selectedProfileHelp);
  const activeHelpCommand = selectedHelpCommand && selectedProfileHelp[selectedHelpCommand] ? selectedHelpCommand : selectedProfileHelpKeys[0] ?? null;
  const selectedHelpEntry = activeHelpCommand ? selectedProfileHelp[activeHelpCommand] ?? null : null;

  const notesModal = editingNotesAgentId && (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
      <div className="bg-[#111114] border border-white/10 p-8 rounded-3xl w-full max-w-lg shadow-2xl">
        <h3 className="text-xl font-black text-white mb-6 uppercase tracking-widest">Agent Notes</h3>
        <textarea
          value={tempNotes}
          onChange={(e) => setTempNotes(e.target.value)}
          className="w-full h-48 bg-black border border-white/10 rounded-xl p-4 text-slate-300 mono text-sm focus:outline-none focus:ring-1 focus:ring-sky-500/50 resize-none"
          placeholder="Observation log for this session..."
        />
        <div className="flex gap-4 mt-8">
          <button type="button" onClick={() => setEditingNotesAgentId(null)} className="flex-1 py-3 text-slate-500 font-bold uppercase text-[10px] tracking-widest">ABORT</button>
          <button type="button" onClick={() => saveNotes(editingNotesAgentId)} className="flex-1 bg-sky-600 hover:bg-sky-500 text-white py-3 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all">SAVE CHANGES</button>
        </div>
      </div>
    </div>
  );

  if (selectedAgent) {
    return (
      <div className="h-full flex flex-col bg-[#050507]">
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#111114]">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                if (selectedAgent) {
                  setAgentOutputs((prev) => ({ ...prev, [selectedAgent.id]: consoleOutput }));
                }
                setSelectedAgent(null);
              }}
              className="p-2 hover:bg-white/5 rounded-lg text-slate-400 transition-colors"
            >
              <Icons.ChevronLeft />
            </button>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <div>
              <h4 className="font-bold text-sm tracking-tight text-white">{selectedAgent.name} <span className="text-slate-500 text-xs mono">  {selectedAgent.user}@{selectedAgent.hostname}</span></h4>
              <p className="text-[10px] text-slate-600 mono uppercase tracking-widest">{selectedAgent.id} | {selectedAgent.ip}</p>
            </div>
          </div>
          <div className="flex gap-6 items-center">
            <button
              type="button"
              onClick={() => {
                setEditingNotesAgentId(selectedAgent.id);
                setTempNotes(selectedAgent.notes);
              }}
              className="text-[10px] font-bold text-sky-500 uppercase tracking-widest flex items-center gap-1.5 hover:underline"
            >
              <Icons.Edit /> Notes
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedHelpCommand(activeHelpCommand);
                setShowHelpModal(true);
              }}
              className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-1.5 hover:underline"
            >
              <Icons.Info /> Manual
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 mono text-sm space-y-2 bg-black/50 custom-scrollbar">
          {consoleOutput.length === 0 && <p className="text-slate-700 italic">No command history for this session yet...</p>}
          {consoleOutput.map((line, i) => (
            <div key={`${i}-${line.slice(0, 16)}`} className={line.startsWith('[') && line.includes('@') ? 'text-emerald-500' : 'text-slate-200'}>
              {line}
            </div>
          ))}
          <div ref={terminalBottomRef} />
        </div>

        {showHelpModal && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-10">
            <div className="bg-[#111114] border border-white/10 rounded-3xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/5">
                <div>
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Command Manual</h3>
                  <p className="text-slate-500 text-xs mono mt-1">Select an instruction to view technical documentation</p>
                </div>
                <button type="button" onClick={() => { setShowHelpModal(false); setSelectedHelpCommand(null); }} className="p-3 hover:bg-rose-500/20 text-slate-400 hover:text-rose-500 rounded-xl transition-all">
                  CLOSE MANUAL
                </button>
              </div>
              <div className="flex flex-1 overflow-hidden">
                <div className="w-1/3 border-r border-white/5 overflow-y-auto p-6 space-y-2 bg-[#0a0a0c] custom-scrollbar">
                  {selectedProfileHelpKeys.length > 0 ? (
                    selectedProfileHelpKeys.map((cmdKey) => (
                      <button
                        key={cmdKey}
                        type="button"
                        onClick={() => setSelectedHelpCommand(cmdKey)}
                        className={`w-full text-left px-4 py-3 rounded-xl transition-all mono text-xs uppercase font-bold tracking-widest ${activeHelpCommand === cmdKey ? 'bg-emerald-500 text-black' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
                      >
                        {cmdKey}
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                      No commands.json data loaded for this profile.
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-10 bg-[#111114]">
                  {selectedHelpEntry ? (
                    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div>
                        <h4 className="text-4xl font-black text-emerald-500 mono mb-4">{selectedHelpEntry.name}</h4>
                        <p className="text-xl text-slate-300 leading-relaxed">{selectedHelpEntry.description}</p>
                      </div>
                      <div className="space-y-8">
                        <div>
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-3">Syntax Definition</p>
                          <div className="p-6 bg-black rounded-2xl border border-white/5 text-slate-300 mono text-base shadow-inner">{selectedHelpEntry.usage}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 text-slate-600">
                        <Icons.Info />
                      </div>
                      <p className="text-slate-600 mono text-sm font-bold uppercase tracking-widest italic">Awaiting Selection...</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {notesModal}

        <form onSubmit={handleSendCommand} className="p-6 bg-[#111114] border-t border-white/5 flex gap-4 shadow-2xl">
          <span className="text-emerald-500 font-bold text-lg mono select-none">&gt;</span>
          <input type="text" autoFocus value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder={`Input instruction for ${selectedAgent.name}...`} className="flex-1 bg-transparent border-none focus:outline-none text-white mono text-lg" />
        </form>
      </div>
    );
  }

  return (
    <div className="p-10 max-w-7xl mx-auto pb-32">
      <header className="mb-12 flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-white mb-2">Agent Callbacks</h2>
          <p className="text-slate-500 mono text-xs uppercase tracking-widest">Active Implants // Monitoring & Tasking</p>
        </div>
        <div className="flex items-center gap-4">
          {selectedIds.size > 0 ? (
            <div className="flex gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <button type="button" onClick={() => setSelectedIds(new Set())} className="text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors">
                Deselect All
              </button>
              <button type="button" onClick={() => setShowMassCommandModal(true)} className="bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-500/10 hover:bg-emerald-500 transition-all">
                Mass Task ({selectedIds.size})
              </button>
              <button type="button" onClick={massPurge} className="bg-rose-600 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-rose-500/10 hover:bg-rose-500 transition-all">
                Mass Purge
              </button>
            </div>
          ) : (
            agents.length > 0 && (
              <button type="button" onClick={selectAll} className="bg-white/5 border border-white/10 hover:bg-white/10 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                Select All Agents
              </button>
            )
          )}
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1" aria-label="Agent view mode">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all ${viewMode === 'cards' ? 'bg-emerald-500 text-black' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
              title="Card view"
              aria-pressed={viewMode === 'cards'}
            >
              <Icons.Grid />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('rows')}
              className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all ${viewMode === 'rows' ? 'bg-emerald-500 text-black' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
              title="Rows view"
              aria-pressed={viewMode === 'rows'}
            >
              <Icons.Rows />
            </button>
          </div>
        </div>
      </header>

      {massResults.length > 0 && (
        <div className="mb-10 bg-[#111114] border border-white/5 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Mass Task Results</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Per-agent output</p>
            </div>
            <button type="button" onClick={() => setMassResults([])} className="text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors">
              Clear Results
            </button>
          </div>
          <div className="space-y-2">
            {massResults.map((result) => (
              <details key={result.id} className="bg-black/40 border border-white/5 rounded-xl p-4">
                <summary className="cursor-pointer flex items-center justify-between text-slate-300">
                  <span className="font-bold mono text-xs uppercase tracking-widest">{result.name}</span>
                  <span className={`text-[10px] font-black px-2 py-1 rounded uppercase tracking-widest ${result.status === 'Success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                    {result.status}
                  </span>
                </summary>
                <div className="mt-3 space-y-1 text-slate-200 mono text-xs">
                  {result.output.map((line) => (
                    <div key={`${result.id}-${line}`}>{line}</div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {agents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => void openAgentConsole(agent)}
              className={`bg-[#111114] border rounded-2xl p-6 cursor-pointer transition-all group relative overflow-hidden flex flex-col h-[320px] ${selectedIds.has(agent.id) ? 'border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'border-white/5 hover:border-emerald-500/30'}`}
            >
              <div className={`absolute top-3 right-3 p-1 transition-opacity flex gap-1 ${selectedIds.has(agent.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                <button
                  type="button"
                  onClick={(e) => toggleSelect(e, agent.id)}
                  className={`p-1 w-7 h-7 rounded-md transition-all ${selectedIds.has(agent.id) ? 'bg-emerald-500 text-black' : 'bg-white/5 text-slate-500 hover:text-white'}`}
                  title="Toggle Selection"
                >
                  <Icons.Plus />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setEditingNotesAgentId(agent.id); setTempNotes(agent.notes); }}
                  title="Edit Notes"
                  className="p-1 w-7 h-7 hover:bg-white/10 rounded-md text-slate-500 hover:text-white transition-all"
                >
                  <Icons.Edit />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); renameAgent(agent.id); }}
                  title="Rename Agent"
                  className="p-1 w-7 h-7 hover:bg-white/10 rounded-md text-slate-500 hover:text-white transition-all"
                >
                  <Icons.Settings />
                </button>
                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteAgent(agent.id); }} className="p-1 w-7 h-7 hover:bg-rose-500/20 rounded-md text-slate-500 hover:text-rose-500 transition-all">
                  <Icons.Delete />
                </button>
              </div>
              <div className="flex justify-between items-start mb-6">
                <span className={`text-[10px] font-black px-2 py-1 rounded tracking-widest uppercase ${getStatusClassName(agent.status)}`}>{agent.status}</span>
              </div>
              <h4 className="text-xl font-bold text-white mb-1 group-hover:text-emerald-400 transition-colors">{agent.name}</h4>
              <p className="text-[10px] text-slate-500 mono uppercase tracking-widest mb-6">{agent.hostname}</p>
              <div className="space-y-2 border-t border-white/5 pt-4">
                <div className="flex justify-between items-center text-[10px] mono">
                  <span className="text-slate-600 uppercase font-bold">Network IP</span>
                  <span className="text-slate-400">{agent.ip}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] mono">
                  <span className="text-slate-600 uppercase font-bold">Operator</span>
                  <span className="text-slate-400">{agent.user}</span>
                </div>
              </div>
              <div className="mt-auto pt-4 border-t border-white/5 text-[10px] text-slate-500 overflow-hidden">
                <div className="flex items-center gap-2 mb-1">
                  <Icons.Edit />
                  <span className="font-bold uppercase tracking-widest text-slate-600">Notes</span>
                </div>
                <p className="truncate-2-lines italic">{agent.notes || 'No observations recorded.'}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-[#111114] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1020px] text-left mono text-xs">
              <thead className="bg-[#343746] border-b border-slate-500/40 text-slate-300">
                <tr>
                  <th className="w-12 px-4 py-3"></th>
                  <th className="px-4 py-3 font-bold">status</th>
                  <th className="px-4 py-3 font-bold">profile</th>
                  <th className="px-4 py-3 font-bold">user</th>
                  <th className="px-4 py-3 font-bold">hostname</th>
                  <th className="px-4 py-3 font-bold">process name</th>
                  <th className="px-4 py-3 font-bold">pid</th>
                  <th className="px-4 py-3 font-bold">architecture</th>
                  <th className="px-4 py-3 font-bold">last checkin</th>
                  <th className="px-4 py-3 font-bold">sleep</th>
                  <th className="w-32 px-4 py-3 text-right font-bold">actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent, index) => {
                  const rowClassName = getRowClassName(selectedIds.has(agent.id), index);
                  return (
                    <tr key={agent.id} onClick={() => void openAgentConsole(agent)} className={`cursor-pointer border-b border-slate-700/60 transition-colors ${rowClassName}`}>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={(e) => toggleSelect(e, agent.id)}
                          className={`h-5 w-5 inline-flex items-center justify-center rounded-sm border text-[10px] transition-all ${selectedIds.has(agent.id) ? 'bg-emerald-500 border-emerald-500 text-white font-bold' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}
                          title="Toggle selection"
                        >
                          {selectedIds.has(agent.id) ? '✓' : ''}
                        </button>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-2 text-[10px] font-black px-2 py-1 rounded uppercase tracking-widest ${getStatusClassName(agent.status)}`}>
                          {agent.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-100">{agent.profile || '-'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-100">{agent.user || '-'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-100 max-w-[160px] truncate" title={agent.hostname}>{agent.hostname || '-'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-100">{agent.process || '-'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-100">{agent.pid || '-'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-100">{agent.arch || '-'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-100">{formatRelativeTime(agent.lastSeen, now)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-100">{agent.sleep ? `${agent.sleep} seconds` : '-'}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditingNotesAgentId(agent.id); setTempNotes(agent.notes); }}
                            title="Edit notes"
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-200 hover:bg-white/10 hover:text-white"
                          >
                            <Icons.Edit />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); renameAgent(agent.id); }}
                            title="Rename agent"
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-200 hover:bg-white/10 hover:text-white"
                          >
                            <Icons.Settings />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); deleteAgent(agent.id); }}
                            title="Delete agent"
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-200 hover:bg-rose-500/20 hover:text-rose-200"
                          >
                            <Icons.Delete />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-8 py-10 text-center text-slate-600 italic">No agents connected.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showMassCommandModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-[#111114] border border-white/10 p-10 rounded-3xl w-full max-w-xl shadow-2xl">
            <h3 className="text-2xl font-black text-white mb-4 tracking-tighter uppercase">Mass Tasking Dispatch</h3>
            <p className="text-slate-500 text-xs mono mb-8">Targeting {selectedIds.size} active implants</p>
            <form onSubmit={handleMassCommandSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Command / Instruction</label>
                <input
                  required
                  autoFocus
                  type="text"
                  value={massCommand}
                  onChange={(e) => setMassCommand(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 mono text-sm"
                  placeholder="e.g. shell whoami"
                />
              </div>
              <div className="flex gap-4 mt-8 pt-6 border-t border-white/5">
                <button type="button" onClick={() => setShowMassCommandModal(false)} className="flex-1 py-4 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-white transition-all">ABORT</button>
                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest py-4 rounded-2xl shadow-lg transition-all">DISPATCH COMMAND</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {notesModal}
    </div>
  );
};

export default AgentsView;
