import React, { useEffect, useRef, useState } from 'react';
import { Agent, User } from '../types';
import { Icons, SERVER_COMMAND_HELP } from '../constants';
import { formatConsoleTimestamp } from '../utils/time';

interface AgentCommandHelp {
  name: string;
  description: string;
  usage: string;
  example?: string;
}

interface AgentProfilesResponse {
  profiles: Array<{
    name: string;
    config: {
      commands?: string[];
      command_descriptions?: Record<string, string>;
      command_usage?: Record<string, string>;
    };
  }>;
}

interface ServerCommandDefinition {
  name: string;
  description: string;
  usage: string;
  category?: string;
}

const parseIndexList = (value: string): number[] => {
  const parts = value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const indexes: number[] = [];
  for (const part of parts) {
    const parsed = Number.parseInt(part, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      indexes.push(parsed);
    }
  }
  return indexes;
};

const invalidSyntax = (command: string, usage: string) => `Invalid syntax for "${command}" command. Usage: ${usage}`;

const consoleTimestampPattern = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/;

const formatConsoleLine = (line: string) => (consoleTimestampPattern.test(line) ? line : `[${formatConsoleTimestamp()}] ${line}`);

export const ConsoleView: React.FC<{
  agents: Agent[];
  currentUser: User;
  onSendAgentCommand: (agentId: string, command: string, user: User) => Promise<string>;
  onRenameAgent: (id: string, name: string) => Promise<void>;
  onDeleteAgent: (id: string, force: boolean) => Promise<void>;
  onRefreshAgents: () => Promise<void>;
  onFetchAgentHistory: (agentId: string) => Promise<string[]>;
  onUpdateAgents: (agents: Agent[]) => void;
}> = ({ agents, currentUser, onSendAgentCommand, onRenameAgent, onDeleteAgent, onRefreshAgents, onFetchAgentHistory, onUpdateAgents }) => {
  const [scrollback, setScrollback] = useState<string[]>([
    'YGGDRASIL CLI initialized.',
    'Type "help" for a list of server commands.',
    '',
  ]);
  const [screen, setScreen] = useState<string[]>([]);
  const [agentOutputs, setAgentOutputs] = useState<Record<string, { scrollback: string[]; screen: string[] }>>({});
  const [skipNextAutoScroll, setSkipNextAutoScroll] = useState(false);
  const [input, setInput] = useState('');
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const [commandHelpByProfile, setCommandHelpByProfile] = useState<Record<string, Record<string, AgentCommandHelp>>>({});
  const [serverCommandHelp, setServerCommandHelp] = useState<Record<string, string>>({});
  const [showAgentList, setShowAgentList] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (skipNextAutoScroll) {
      // Skip a single auto-scroll (used after clear so user sees empty screen but can scroll up)
      setSkipNextAutoScroll(false);
      return;
    }
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scrollback, screen]);

  useEffect(() => {
    const loadCommandHelp = async () => {
      try {
        const profileResponse = await fetch('/api/agent-profiles', { credentials: 'include', cache: 'no-store' });
        if (!profileResponse.ok) {
          throw new Error(`Request failed with HTTP ${profileResponse.status}`);
        }

        const data = (await profileResponse.json()) as AgentProfilesResponse;
        const mapped: Record<string, Record<string, AgentCommandHelp>> = {};

        for (const profile of data.profiles ?? []) {
          const help: Record<string, AgentCommandHelp> = {};
          const commands = profile.config.commands ?? [];
          for (const command of commands) {
            const description = profile.config.command_descriptions?.[command]
              ?? profile.config.command_descriptions?.[command.toLowerCase()]
              ?? `${command} is defined by the selected agent profile.`;
            const usage = profile.config.command_usage?.[command]
              ?? profile.config.command_usage?.[command.toLowerCase()]
              ?? `${command} [arguments]`;

            help[command] = {
              name: command,
              description,
              usage,
              example: usage,
            };
          }
          mapped[profile.name] = help;
        }

        setCommandHelpByProfile(mapped);
        setServerCommandHelp(SERVER_COMMAND_HELP);
      } catch {
        setCommandHelpByProfile({});
        setServerCommandHelp(SERVER_COMMAND_HELP);
      }
    };

    void loadCommandHelp();
  }, []);

  const activeAgent = agents.find((agent) => agent.id === currentAgentId) ?? null;
  const selectedProfileCommands = activeAgent ? commandHelpByProfile[activeAgent.profile] ?? {} : {};

  const appendOutput = (lines: string[]) => {
    setScreen((prev) => [...prev, ...lines.map(formatConsoleLine)]);
  };

  const listAgents = () => {
    if (agents.length === 0) {
      appendOutput(['No active agent callbacks.']);
      return;
    }

    const rows = [
      'Index | Agent Name | Hostname | IP | Status',
      '------------------------------------------',
      ...agents.map((agent, index) => `${index} | ${agent.name.padEnd(12)} | ${agent.hostname.padEnd(10)} | ${agent.ip.padEnd(12)} | ${agent.status}`),
    ];
    appendOutput(rows);
  };

  const clearScreen = () => {
    const clearMarker = formatConsoleLine('--- screen cleared ---');
    const nextScreen = [clearMarker, ''];

    // push current screen into scrollback for this agent, but don't auto-scroll
    if (currentAgentId) {
      setAgentOutputs((prev) => {
        const existing = prev[currentAgentId] ?? { scrollback: [], screen: [] };
        return {
          ...prev,
          [currentAgentId]: {
            scrollback: [...existing.scrollback, ...scrollback, ...screen, clearMarker],
            screen: nextScreen,
          },
        };
      });
    } else {
      // Global fallback
      setScrollback((prev) => [...prev, ...screen, clearMarker]);
      setScreen(nextScreen);
    }
    setSkipNextAutoScroll(true);
  };

  const runHelp = () => {
    const serverEntries = Object.entries(serverCommandHelp).length > 0
      ? Object.entries(serverCommandHelp).map(([command, description]) => `  └─ ${command}: ${String(description ?? '')}`)
      : ['  └─ No server commands metadata loaded.'];
    const lines = ['Server Commands:', ...serverEntries];

    if (activeAgent) {
      const agentEntries = Object.entries(selectedProfileCommands);
      lines.push(`Agent Commands (${activeAgent.profile}):`);
      if (agentEntries.length === 0) {
        lines.push('  └─ No command metadata loaded for this profile.');
      } else {
        lines.push(
          ...agentEntries.map(([command, help]) => `  └─ ${command}: ${help.description} | usage: ${help.usage}`),
        );
      }
    } else {
      lines.push('Select an active agent to see agent-specific commands.');
    }

    appendOutput(lines);
  };

  const runUse = (rawArgs: string) => {
    const indexToken = rawArgs.trim();
    if (!indexToken) {
      appendOutput([invalidSyntax('use', 'use <index>')]);
      return;
    }

    const index = Number.parseInt(indexToken, 10);
    const target = agents[index];
    if (!target) {
      appendOutput(['Error: Invalid agent index. Run "agents" to view available targets.']);
      return;
    }

    // Persist current agent outputs
    const nextAgentOutputs = currentAgentId
      ? { ...agentOutputs, [currentAgentId]: { scrollback, screen } }
      : agentOutputs;
    if (currentAgentId) {
      setAgentOutputs(nextAgentOutputs);
    }

    // Load outputs for the new agent if present, otherwise try to fetch history
    const loadFor = async (id: string) => {
      const saved = nextAgentOutputs[id];
      if (saved) {
        setScrollback(saved.scrollback);
        setScreen(saved.screen);
      } else {
        try {
          const history = await onFetchAgentHistory(id);
          setScrollback(history);
          setScreen([]);
        } catch {
          setScrollback([]);
          setScreen([]);
        }
      }
    };

    setCurrentAgentId(target.id);
    void loadFor(target.id);
    appendOutput([`Context switched to agent: ${target.name} (${target.id})`]);
  };

  const runHistory = async () => {
    if (!activeAgent) {
      appendOutput(['Error: No active agent selected. Use "agents" to select one.']);
      return;
    }

    try {
      const entries = await onFetchAgentHistory(activeAgent.id);
      appendOutput([
        `Command history for ${activeAgent.name} (${activeAgent.id}):`,
        ...(entries.length > 0 ? entries : ['No command history available.']),
      ]);
    } catch (error) {
      appendOutput([`Error: ${(error as Error).message}`]);
    }
  };

  const runDelete = async (rawArgs: string) => {
    const indexes = parseIndexList(rawArgs);
    if (indexes.length === 0) {
      appendOutput([invalidSyntax('delete', 'delete <index[,index...]>')]);
      return;
    }

    const selected = indexes
      .map((index) => agents[index])
      .filter(Boolean);

    if (selected.length === 0) {
      appendOutput(['Error: No valid agent indexes were supplied for deletion.']);
      return;
    }

    for (const agent of selected) {
      try {
        await onDeleteAgent(agent.id, false);
        appendOutput([`Deleted agent: ${agent.name} (${agent.id})`]);
      } catch (error) {
        const message = (error as Error).message;
        const shouldForce = message.toLowerCase().includes('force');
        if (shouldForce) {
          try {
            await onDeleteAgent(agent.id, true);
            appendOutput([`Force-deleted agent: ${agent.name} (${agent.id})`]);
          } catch (forceError) {
            appendOutput([`Error deleting ${agent.name}: ${(forceError as Error).message}`]);
          }
          continue;
        }
        appendOutput([`Error deleting ${agent.name}: ${message}`]);
      }
    }

    await onRefreshAgents();
    if (currentAgentId && !agents.some((agent) => agent.id === currentAgentId)) {
      setCurrentAgentId(null);
    }
  };

  const runRename = async (rawArgs: string) => {
    const tokens = rawArgs.trim().split(/\s+/);
    if (tokens.length < 2) {
      appendOutput([invalidSyntax('rename', 'rename <index> <new-name>')]);
      return;
    }

    const [indexToken, ...nameParts] = tokens;
    const index = Number.parseInt(indexToken, 10);
    const newName = nameParts.join(' ');

    if (Number.isNaN(index) || !newName.trim()) {
      appendOutput([invalidSyntax('rename', 'rename <index> <new-name>')]);
      return;
    }

    const target = agents[index];
    if (!target) {
      appendOutput(['Error: Invalid agent index. Run "agents" to view available targets.']);
      return;
    }

    try {
      await onRenameAgent(target.id, newName.trim());
      appendOutput([`Renamed agent ${target.name} to ${newName.trim()}.`]);
      await onRefreshAgents();
      if (currentAgentId === target.id) {
        setCurrentAgentId(target.id);
      }
    } catch (error) {
      appendOutput([`Error: ${(error as Error).message}`]);
    }
  };

  const runMass = async (rawArgs: string) => {
    const tokens = rawArgs.trim().split(/\s+/);
    if (tokens.length < 2) {
      appendOutput([invalidSyntax('mass', 'mass <index[,index...]> <command>')]);
      return;
    }

    const selectedIndexes = parseIndexList(tokens[0]);
    const commandText = tokens.slice(1).join(' ');
    if (selectedIndexes.length === 0 || !commandText.trim()) {
      appendOutput([invalidSyntax('mass', 'mass <index[,index...]> <command>')]);
      return;
    }

    const selectedAgents = selectedIndexes
      .map((index) => agents[index])
      .filter(Boolean);

    if (selectedAgents.length === 0) {
      appendOutput(['Error: No valid agent indexes were supplied for mass execution.']);
      return;
    }

    const results = await Promise.all(
      selectedAgents.map(async (agent) => {
        try {
          const output = await onSendAgentCommand(agent.id, commandText, currentUser);
          return `${agent.name} (${agent.id}): ${output || '(no output)'}`;
        } catch (error) {
          return `${agent.name} (${agent.id}): Error: ${(error as Error).message}`;
        }
      }),
    );

    appendOutput(['Mass execution results:', ...results]);
  };

  const processCommand = async (commandLine: string) => {
    const trimmed = commandLine.trim();
    if (!trimmed) {
      return;
    }

    const raw = trimmed.replace(/\s+/g, ' ');
    const [command, ...rest] = raw.split(' ');
    const literal = command.toLowerCase();
    const args = rest.join(' ');

    switch (literal) {
      case 'agents':
        listAgents();
        break;
      case 'use':
        runUse(args);
        break;
      case 'history':
        await runHistory();
        break;
      case 'clear':
        clearScreen();
        appendOutput(['[screen cleared]']);
        break;
      case 'delete':
        await runDelete(args);
        break;
      case 'rename':
        await runRename(args);
        break;
      case 'mass':
        await runMass(args);
        break;
      case 'help':
        runHelp();
        break;
      default: {
        if (activeAgent && selectedProfileCommands[command]) {
          try {
            const output = await onSendAgentCommand(activeAgent.id, trimmed, currentUser);
            const lines = output ? output.split('\n').filter(Boolean) : ['Task accepted by listener core.'];
            appendOutput([`Relaying task "${trimmed}" to ${activeAgent.id}...`, ...lines]);
          } catch (error) {
            appendOutput([`Error: ${(error as Error).message}`]);
          }
          break;
        }

        if (activeAgent && command.trim()) {
          appendOutput([invalidSyntax(command, `${command} <arguments>`)]);
          break;
        }

        appendOutput([`Error: Command "${command}" not found. Try "help".`]);
      }
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }

    const commandText = input.trim();
    const agentLabel = activeAgent ? `[${activeAgent.name}]` : '';
    appendOutput([`${currentUser.username}@yggdrasil${agentLabel}:~$ ${commandText}`]);
    setInput('');
    await processCommand(commandText);
  };

  const selectAgent = (agent: Agent) => {
    // Persist current agent outputs
    const nextAgentOutputs = currentAgentId
      ? { ...agentOutputs, [currentAgentId]: { scrollback, screen } }
      : agentOutputs;
    if (currentAgentId) {
      setAgentOutputs(nextAgentOutputs);
    }

    const loadFor = async (id: string) => {
      const saved = nextAgentOutputs[id];
      if (saved) {
        setScrollback(saved.scrollback);
        setScreen(saved.screen);
      } else {
        try {
          const history = await onFetchAgentHistory(id);
          setScrollback(history);
          setScreen([]);
        } catch {
          setScrollback([]);
          setScreen([]);
        }
      }
    };

    setCurrentAgentId(agent.id);
    void loadFor(agent.id);
    appendOutput([`Context switched to agent: ${agent.name} (${agent.id})`]);
  };

  const allOutput = [...scrollback, ...screen];

  const agentListDisplay = agents.map((agent, index) => (
    <button
      type="button"
      key={agent.id}
      onClick={() => selectAgent(agent)}
      className={`block w-full text-left px-3 py-2 rounded-lg border ${currentAgentId === agent.id ? 'border-emerald-500/60 bg-emerald-500/10 text-white' : 'border-white/5 bg-black/20 text-slate-300 hover:border-white/10'}`}
    >
      <span className="font-bold mono text-[11px]">{index}</span> · {agent.name} · {agent.hostname} · {agent.ip} · {agent.status}
    </button>
  ));

  return (
    <div className="h-full bg-[#050507] flex flex-col p-8 font-mono overflow-hidden">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Session</span>
          <span className="text-emerald-500 font-bold text-sm">{activeAgent ? activeAgent.name : 'No agent selected'}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">
          <Icons.Terminal />
          <span>Yggdrasil Console</span>
        </div>
      </div>

          {agents.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Agents ({agents.length})</div>
                <button
                  type="button"
                  onClick={() => setShowAgentList((s) => !s)}
                  className="text-[10px] font-bold px-3 py-1 rounded-lg border border-white/10 bg-black/20 text-slate-300 hover:bg-white/5 transition-all"
                >
                  {showAgentList ? 'Hide' : 'Show'}
                </button>
              </div>

              {showAgentList && (
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto rounded-xl border border-white/5 bg-[#111114] p-2 custom-scrollbar">
                  {agentListDisplay}
                </div>
              )}
            </div>
          )}

      <div className="flex-1 overflow-y-auto space-y-1 mb-6 custom-scrollbar text-sm text-emerald-500 bg-black/30 p-4 rounded-xl border border-white/5">
        {allOutput.map((line, index) => (
          <div key={`${line}-${index}`} className={line.startsWith('[') && line.includes(']') ? 'text-slate-200' : 'text-emerald-500'}>
            {line}
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-4 border-t border-white/5 pt-6 items-center shrink-0">
        <span className="text-emerald-500 font-bold whitespace-nowrap">{currentUser.username}@yggdrasil{activeAgent ? <span className="text-sky-500">[{activeAgent.name}]</span> : ''}:~$</span>
        <input type="text" autoFocus value={input} onChange={(e) => setInput(e.target.value)} className="flex-1 bg-transparent border-none focus:outline-none text-emerald-500 mono text-base" placeholder="Enter command..." />
      </form>
    </div>
  );
};

export default ConsoleView;
