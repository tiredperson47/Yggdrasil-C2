import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HostedFile } from '../types';

const AGENT_PROFILES_ROOT = '/app/Agent_Profiles';
const COMPILED_PAYLOADS_ROOT = `/app/Compiled_Payloads`;
const AGENT_PROFILES_ENDPOINT = '/api/agent-profiles';
const BUILD_AGENT_ENDPOINT = '/api/build-agent';
const DEFAULT_OUTPUT_NAME = 'agent';

interface BeaconConfig {
  profile_id: string;
  os: string[];
  languages: string[];
  commands: string[];
  required_commands: string[];
  command_descriptions: Record<string, string>;
  command_usage: Record<string, string>;
  payload_output: string[];
  architectures: string[];
  supported_listeners: string[];
  supported_wrappers: Record<string, WrapperProjectConfig>;
}

interface WrapperProjectConfig {
  supported_modules: Record<string, WrapperModuleConfig>;
}

interface WrapperModuleConfig {
  required_fields?: string[];
  required?: Record<string, unknown>;
  optional?: string[];
}

interface AgentProfile {
  name: string;
  projectRoot: string;
  configPath: string;
  config: BeaconConfig;
}

interface AgentProfilesResponse {
  profiles: AgentProfile[];
  warnings?: string[];
}

interface BuildAgentRequest {
  profileID: string;
  agentProfile: string;
  architecture: string;
  os: string;
  language: string;
  wrapper: string;
  commands: string[];
  requiredCommands: string[];
  listener: string;
  host: string;
  port: string;
  useAES: number;
  outputType: string;
  outputFileName: string;
  wrapperArgs: string;
}

interface BuildAgentResponse {
  message?: string;
  outputFileName?: string;
  outputPath?: string;
  logs?: string[] | string;
  error?: string;
}

interface BuilderState {
  agentProfile: string;
  architecture: string;
  operatingSystem: string;
  language: string;
  wrapperProject: string;
  wrapperModule: string;
  selectedCommands: string[];
  listener: string;
  listenerHost?: string;
  listenerPort?: string;
  useAES: boolean;
  outputType: string;
  outputFileName: string;
  wrapperArgValues: Record<string, string>;
}

type SectionNumber = 1 | 2 | 3 | 4 | 5;

const emptyConfig: BeaconConfig = {
  profile_id: '',
  os: [],
  languages: [],
  commands: [],
  required_commands: [],
  command_descriptions: {},
  command_usage: {},
  payload_output: [],
  architectures: [],
  supported_listeners: [],
  supported_wrappers: {},
};

const createInitialBuilderState = (): BuilderState => ({
  agentProfile: '',
  architecture: '',
  operatingSystem: '',
  language: '',
  wrapperProject: '',
  wrapperModule: '',
  selectedCommands: [],
  listener: '',
  listenerHost: '',
  listenerPort: '',
  useAES: false,
  outputType: '',
  outputFileName: DEFAULT_OUTPUT_NAME,
  wrapperArgValues: {},
});

const normalizeStringMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, mapValue]) => {
    if (typeof mapValue === 'string') {
      result[key] = mapValue;
    }
  });
  return result;
};

const normalizeSupportedWrappers = (value: unknown): Record<string, WrapperProjectConfig> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Record<string, WrapperProjectConfig> = {};
  Object.entries(value as Record<string, unknown>).forEach(([projectName, projectValue]) => {
    if (!projectValue || typeof projectValue !== 'object' || Array.isArray(projectValue)) return;

    const supportedModulesRaw = (projectValue as Record<string, unknown>).supported_modules;
    if (!supportedModulesRaw || typeof supportedModulesRaw !== 'object' || Array.isArray(supportedModulesRaw)) {
      result[projectName] = { supported_modules: {} };
      return;
    }

    const supportedModules: Record<string, WrapperModuleConfig> = {};
    Object.entries(supportedModulesRaw as Record<string, unknown>).forEach(([moduleName, moduleValue]) => {
      if (!moduleValue || typeof moduleValue !== 'object' || Array.isArray(moduleValue)) return;
      const moduleObject = moduleValue as Record<string, unknown>;
      const requiredFieldsFromConfig = Array.isArray(moduleObject.required_fields)
        ? moduleObject.required_fields.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      const requiredFieldNamesFromRequired = (() => {
        const requiredObject = moduleObject.required;
        if (!requiredObject || typeof requiredObject !== 'object' || Array.isArray(requiredObject)) return [];

        const fields = (requiredObject as Record<string, unknown>).fields;
        if (!Array.isArray(fields)) return [];

        return fields.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      })();
      const requiredFields = [...requiredFieldsFromConfig, ...requiredFieldNamesFromRequired];
      const required = moduleObject.required && typeof moduleObject.required === 'object' && !Array.isArray(moduleObject.required)
        ? Object.entries(moduleObject.required as Record<string, unknown>).reduce<Record<string, unknown>>((accumulator, [key, requiredValue]) => {
            if (key === 'fields') return accumulator;
            accumulator[key] = requiredValue;
            return accumulator;
          }, {})
        : {};
      const optional = Array.isArray(moduleObject.optional)
        ? moduleObject.optional.filter((item): item is string => typeof item === 'string')
        : [];

      supportedModules[moduleName] = {
        required_fields: requiredFields,
        required,
        optional,
      };
    });

    result[projectName] = { supported_modules: supportedModules };
  });

  return result;
};

const uniqueStrings = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    if (typeof value !== 'string') return;

    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;

    seen.add(trimmed);
    result.push(trimmed);
  });

  return result;
};

const normalizeConfig = (config: Partial<BeaconConfig> | undefined): BeaconConfig => ({
  profile_id: typeof config?.profile_id === 'string' ? config.profile_id.trim() : '',
  os: uniqueStrings(config?.os),
  languages: uniqueStrings(config?.languages),
  commands: uniqueStrings(config?.commands),
  required_commands: uniqueStrings(config?.required_commands),
  command_descriptions: normalizeStringMap(config?.command_descriptions),
  command_usage: normalizeStringMap(config?.command_usage),
  payload_output: uniqueStrings(config?.payload_output),
  architectures: uniqueStrings(config?.architectures),
  supported_listeners: uniqueStrings(config?.supported_listeners),
  supported_wrappers: normalizeSupportedWrappers(config?.supported_wrappers),
});

const normalizeProfile = (profile: AgentProfile): AgentProfile => ({
  ...profile,
  config: normalizeConfig(profile.config),
});

const firstAvailable = (currentValue: string, options: string[]) => (options.includes(currentValue) ? currentValue : options[0] ?? '');

const mergeSelectedCommands = (commands: string[], requiredCommands: string[], currentSelection: string[]) => {
  const allowed = new Set(commands);
  const merged = [...requiredCommands, ...currentSelection].filter((command) => allowed.has(command));
  return commands.filter((command) => merged.includes(command));
};

const applyProfileDefaults = (previous: BuilderState, profile: AgentProfile): BuilderState => {
  const config = profile.config;
  const wrapperProjects = Object.keys(config.supported_wrappers ?? {});
  const wrapperProject = firstAvailable(previous.wrapperProject, ['', ...wrapperProjects]);
  const wrapperModules = wrapperProject
    ? Object.keys(config.supported_wrappers?.[wrapperProject]?.supported_modules ?? {})
    : [];
  const wrapperModule = wrapperProject ? firstAvailable(previous.wrapperModule, wrapperModules) : '';

  return {
    ...previous,
    agentProfile: profile.name,
    architecture: firstAvailable(previous.architecture, config.architectures),
    operatingSystem: firstAvailable(previous.operatingSystem, config.os),
    language: firstAvailable(previous.language, config.languages),
    wrapperProject,
    wrapperModule,
    listener: firstAvailable(previous.listener, config.supported_listeners),
    useAES: previous.useAES,
    outputType: firstAvailable(previous.outputType, config.payload_output),
    outputFileName: previous.outputFileName.trim() || DEFAULT_OUTPUT_NAME,
    selectedCommands: mergeSelectedCommands(config.commands, config.required_commands, previous.selectedCommands),
  };
};

const sanitizeOutputBaseName = (fileName: string) => {
  const sanitized = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || DEFAULT_OUTPUT_NAME;
};

const buildOutputFileName = (baseName: string, outputType: string) => `${sanitizeOutputBaseName(baseName)}`;

const parseWrapperArgValue = (rawValue: string): unknown => {
  const trimmed = rawValue.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const buildWrapperArgsJSON = (argNames: string[], values: Record<string, string>): string => {
  const payload: Record<string, unknown> = {};

  argNames.forEach((argName) => {
    const parsedValue = parseWrapperArgValue(values[argName] ?? '');
    if (parsedValue !== undefined) {
      payload[argName] = parsedValue;
    }
  });

  return JSON.stringify(payload);
};

const commandInfo = (
  command: string,
  requiredCommands: Set<string>,
  selectedCommands: Set<string>,
  descriptions?: Record<string, string>,
  usage?: Record<string, string>,
) => {
  if (!command) {
    return {
      information: 'Select a command to inspect it.',
      commandlineHelp: '',
      needsAdminPermissions: 'Unknown',
      description: '',
    };
  }

  const status = requiredCommands.has(command)
    ? 'This command is required by the selected agent profile.'
    : selectedCommands.has(command)
      ? 'This command will be compiled into the agent.'
      : 'This command is available but not currently included.';

  return {
    information: status,
    commandlineHelp: usage?.[command] ?? `${command} [arguments]`,
    needsAdminPermissions: 'Profile-defined',
    description: descriptions?.[command] ?? `${command} is defined by the selected agent profile commands.json.`,
  };
};

const requestJSON = async <ResponseBody,>(url: string, init?: RequestInit): Promise<ResponseBody> => {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === 'string' ? body : body?.error ?? `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as ResponseBody;
};

const normalizeLogs = (logs: BuildAgentResponse['logs']) => {
  if (Array.isArray(logs)) return logs;
  if (typeof logs === 'string') {
    return logs
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
  }
  return [];
};

interface StepperProps {
  activeSection: SectionNumber;
  completed: Record<number, boolean>;
  onSelect: (section: SectionNumber) => void;
  hasWrapperSection: boolean;
}

const Stepper: React.FC<StepperProps> = ({ activeSection, completed, onSelect, hasWrapperSection }) => {
  const steps: Array<{ number: SectionNumber; title: string }> = hasWrapperSection
    ? [
        { number: 1, title: 'Profile' },
        { number: 2, title: 'Commands' },
        { number: 3, title: 'Listener' },
        { number: 4, title: 'Wrapper' },
        { number: 5, title: 'Output' },
      ]
    : [
        { number: 1, title: 'Profile' },
        { number: 2, title: 'Commands' },
        { number: 3, title: 'Listener' },
        { number: 4, title: 'Output' },
      ];

  return (
    <nav className="mb-8 rounded-md bg-[#2f3b45] px-5 py-6">
      <div className={`grid gap-4 ${hasWrapperSection ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {steps.map((step, index) => {
          const isActive = activeSection === step.number;
          const isComplete = completed[step.number];

          return (
            <button
              key={step.number}
              type="button"
              onClick={() => onSelect(step.number)}
              className="relative flex min-h-20 flex-col items-center justify-center gap-3 text-center"
            >
              {index > 0 && <span className="absolute right-1/2 top-5 h-px w-full bg-slate-500/60" />}
              <span
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-black ${
                  isComplete
                    ? 'bg-[#79cef2] text-[#1f2630]'
                    : isActive
                      ? 'bg-[#79cef2] text-white'
                      : 'bg-slate-500 text-white'
                }`}
              >
                {isComplete ? 'OK' : step.number}
              </span>
              <span className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-slate-300'}`}>{step.title}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

interface ChoiceGridProps {
  label: string;
  options: string[];
  value: string;
  onSelect: (value: string) => void;
}

interface SelectOption {
  label: string;
  value: string;
}

interface SelectFieldProps {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

const SelectField: React.FC<SelectFieldProps> = ({ label, options, value, onChange }) => (
  <label className="block">
    <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={options.length === 0}
      className="h-12 w-full rounded-md border border-white/10 bg-[#202832] px-4 text-sm font-bold text-white outline-none transition-all focus:border-[#79cef2] disabled:cursor-not-allowed disabled:text-slate-500"
    >
      {options.length === 0 ? (
        <option value="">None defined</option>
      ) : (
        options.map((option) => (
          <option key={`${label}-${option.value || 'none'}`} value={option.value}>
            {option.label}
          </option>
        ))
      )}
    </select>
  </label>
);

const ChoiceGrid: React.FC<ChoiceGridProps> = ({ label, options, value, onSelect }) => (
  <div>
    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
    {options.length === 0 ? (
      <div className="rounded-md border border-white/10 bg-[#202832] px-4 py-3 text-sm text-slate-500">None defined</div>
    ) : (
      <div className="grid max-h-72 grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={`min-h-11 rounded-md border px-4 py-3 text-left text-sm font-bold transition-all ${
              value === option
                ? 'border-[#79cef2] bg-[#79cef2]/15 text-white'
                : 'border-white/10 bg-[#202832] text-slate-300 hover:border-[#79cef2]/70 hover:text-white'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    )}
  </div>
);

interface BuilderSectionProps {
  number: SectionNumber;
  title: string;
  active: boolean;
  complete: boolean;
  children: React.ReactNode;
}

const BuilderSection: React.FC<BuilderSectionProps> = ({ number, title, active, complete, children }) => (
  <section
    className={`rounded-md border bg-[#2f3b45] shadow-xl shadow-black/20 ${
      active ? 'border-[#79cef2]' : complete ? 'border-[#79cef2]/60' : 'border-white/10'
    }`}
  >
    <div className="flex items-center justify-between border-b border-[#79cef2] px-5 py-4">
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-black ${
          complete ? 'bg-[#79cef2] text-[#1f2630]' : active ? 'bg-[#79cef2] text-[#1f2630]' : 'bg-slate-600 text-white'
        }`}
      >
        {complete ? 'OK' : number}
      </span>
    </div>
    <div className="p-5">{children}</div>
  </section>
);

interface CommandListProps {
  title: string;
  commands: string[];
  activeCommand: string;
  selectedCommands: Set<string>;
  requiredCommands: Set<string>;
  onCommandClick: (command: string) => void;
  included: boolean;
}

const CommandList: React.FC<CommandListProps> = ({
  title,
  commands,
  activeCommand,
  selectedCommands,
  requiredCommands,
  onCommandClick,
  included,
}) => (
  <div className="flex h-[420px] max-h-[55vh] min-h-[320px] flex-col rounded-md border border-white/10 bg-[#303d47] shadow-lg shadow-black/20">
    <div className="border-b border-[#79cef2] px-5 py-4">
      <h4 className="text-2xl font-light text-white">{title}</h4>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {commands.length === 0 ? (
        <div className="px-2 py-4 text-sm text-slate-500">No commands</div>
      ) : (
        commands.map((command) => {
          const isActive = activeCommand === command;
          const isRequired = requiredCommands.has(command);
          const isChecked = included || selectedCommands.has(command);

          return (
            <button
              key={command}
              type="button"
              onClick={() => onCommandClick(command)}
              className={`mb-1 flex w-full items-center gap-4 rounded px-2 py-3 text-left text-sm transition-all ${
                isActive ? 'bg-[#79cef2]/15 text-white' : isRequired && included ? 'text-slate-400' : 'text-slate-200 hover:bg-white/5'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border-2 ${
                  isChecked ? 'border-slate-300 bg-transparent' : 'border-slate-400'
                } ${isRequired && included ? 'opacity-50' : ''}`}
              >
                {isChecked && <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />}
              </span>
              <span className="break-all font-medium">{command}</span>
              {isRequired && included && <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-[#79cef2]">Required</span>}
            </button>
          );
        })
      )}
    </div>
  </div>
);

export const PayloadsView: React.FC<{ onFileCreated: (f: HostedFile) => void }> = ({ onFileCreated }) => {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [builder, setBuilder] = useState<BuilderState>(() => createInitialBuilderState());
  const [activeSection, setActiveSection] = useState<SectionNumber>(1);
  const [activeAvailableCommand, setActiveAvailableCommand] = useState('');
  const [activeIncludedCommand, setActiveIncludedCommand] = useState('');
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [isBuilding, setIsBuilding] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const profileByName = useMemo(() => new Map(profiles.map((profile) => [profile.name, profile])), [profiles]);
  const selectedProfile = profileByName.get(builder.agentProfile) ?? null;
  const config = selectedProfile?.config ?? emptyConfig;
  const wrapperProjects = useMemo(() => Object.keys(config.supported_wrappers ?? {}), [config.supported_wrappers]);
  const selectedWrapperProject = builder.wrapperProject;
  const wrapperModules = useMemo(
    () => Object.keys(config.supported_wrappers?.[selectedWrapperProject]?.supported_modules ?? {}),
    [config.supported_wrappers, selectedWrapperProject],
  );
  const selectedWrapperModule = builder.wrapperModule;
  const selectedWrapperPath =
    selectedWrapperProject && selectedWrapperModule ? `/app/Wrappers/${selectedWrapperProject}/${selectedWrapperModule}` : '';
  const hasWrapperSection = Boolean(selectedWrapperPath);

  const selectedWrapperModuleSpec =
    config.supported_wrappers?.[selectedWrapperProject]?.supported_modules?.[selectedWrapperModule] ?? null;

  const wrapperArgNames = useMemo(() => {
    const requiredFields = Array.isArray(selectedWrapperModuleSpec?.required_fields)
      ? selectedWrapperModuleSpec.required_fields.map(String)
      : [];
    const requiredKeys = Object.keys(selectedWrapperModuleSpec?.required ?? {}).filter((key) => key !== 'fields');
    const optionalFields = Array.isArray(selectedWrapperModuleSpec?.optional)
      ? selectedWrapperModuleSpec.optional.map(String)
      : [];
    return Array.from(new Set([...requiredFields, ...requiredKeys, ...optionalFields]));
  }, [selectedWrapperModuleSpec]);
  const requiredWrapperArgs = useMemo(() => {
    const requiredFields = selectedWrapperModuleSpec?.required_fields ?? [];
    const requiredKeys = Object.keys(selectedWrapperModuleSpec?.required ?? {}).filter((key) => key !== 'fields');
    return new Set([...requiredFields, ...requiredKeys]);
  }, [selectedWrapperModuleSpec]);
  const outputSection = hasWrapperSection ? 5 : 4;

  const requiredCommandSet = useMemo(() => new Set(config.required_commands), [config.required_commands]);
  const selectedCommandSet = useMemo(() => new Set(builder.selectedCommands), [builder.selectedCommands]);

  const availableCommands = useMemo(
    () => config.commands.filter((command) => !selectedCommandSet.has(command)),
    [config.commands, selectedCommandSet],
  );

  const includedCommands = useMemo(
    () => config.commands.filter((command) => selectedCommandSet.has(command)),
    [config.commands, selectedCommandSet],
  );

  const focusedCommand = activeIncludedCommand || activeAvailableCommand || includedCommands[0] || availableCommands[0] || '';
  const focusedCommandInfo = commandInfo(
    focusedCommand,
    requiredCommandSet,
    selectedCommandSet,
    config.command_descriptions,
    config.command_usage,
  );

  const completed = useMemo<Record<number, boolean>>(() => {
    const outputComplete = Boolean(builder.outputType && builder.outputFileName.trim());
    const wrapperArgsComplete = wrapperArgNames.every((argName) => !requiredWrapperArgs.has(argName) || Boolean(builder.wrapperArgValues[argName]?.trim()));

    if (hasWrapperSection) {
      return {
        1: Boolean(builder.agentProfile && builder.architecture && config.profile_id),
        2: builder.selectedCommands.length > 0 && config.required_commands.every((command) => selectedCommandSet.has(command)),
        3: Boolean(builder.listener),
        4: wrapperArgsComplete,
        5: outputComplete,
      };
    }

    return {
      1: Boolean(builder.agentProfile && builder.architecture && config.profile_id),
      2: builder.selectedCommands.length > 0 && config.required_commands.every((command) => selectedCommandSet.has(command)),
      3: Boolean(builder.listener),
      4: outputComplete,
      5: false,
    };
  }, [builder, config.profile_id, config.required_commands, hasWrapperSection, requiredWrapperArgs, selectedCommandSet, wrapperArgNames]);

  const setBuilderValue = <Key extends keyof BuilderState,>(key: Key, value: BuilderState[Key]) => {
    setBuilder((previous) => ({ ...previous, [key]: value }));
  };

  const loadProfiles = useCallback(async (preferredProfile?: string) => {
    setIsLoadingProfiles(true);
    setLoadError(null);
    setBuildLogs([`[*] Loading profile configs through ${AGENT_PROFILES_ENDPOINT}`]);

    try {
      const data = await requestJSON<AgentProfilesResponse>(AGENT_PROFILES_ENDPOINT, { cache: 'no-store' });
      const loadedProfiles = (data.profiles ?? []).map(normalizeProfile);

      if (loadedProfiles.length === 0) {
        setProfiles([]);
        setLoadError(`No agent profiles were returned. Expected configs under ${AGENT_PROFILES_ROOT}/<PROFILE>/config.json.`);
        setBuildLogs([
          `[*] ${AGENT_PROFILES_ENDPOINT} returned no profiles`,
          ...(data.warnings ?? []).map((warning) => `[WARN] ${warning}`),
        ]);
        return;
      }

      const activeProfile = loadedProfiles.find((profile) => profile.name === preferredProfile) ?? loadedProfiles[0];

      setProfiles(loadedProfiles);
      setBuilder((previous) => applyProfileDefaults(previous, activeProfile));
      setActiveAvailableCommand('');
      setActiveIncludedCommand(activeProfile.config.required_commands[0] ?? '');
      setBuildLogs([
        `[+] Loaded ${loadedProfiles.length} agent profile${loadedProfiles.length === 1 ? '' : 's'}`,
        `[+] Active config: ${activeProfile.configPath}`,
        ...(data.warnings ?? []).map((warning) => `[WARN] ${warning}`),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProfiles([]);
      setLoadError(message);
      setBuildLogs([`[ERROR] ${message}`]);
    } finally {
      setIsLoadingProfiles(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (wrapperProjects.length === 0) {
      if (builder.wrapperProject || builder.wrapperModule) {
        setBuilder((previous) => ({ ...previous, wrapperProject: '', wrapperModule: '' }));
      }
      return;
    }

    if (!builder.wrapperProject) {
      if (builder.wrapperModule) {
        setBuilder((previous) => ({ ...previous, wrapperModule: '' }));
      }
      return;
    }

    if (!wrapperProjects.includes(builder.wrapperProject)) {
      setBuilder((previous) => ({ ...previous, wrapperProject: wrapperProjects[0], wrapperModule: '' }));
      return;
    }

    if (wrapperModules.length === 0) {
      if (builder.wrapperModule) {
        setBuilder((previous) => ({ ...previous, wrapperModule: '' }));
      }
      return;
    }

    if (!wrapperModules.includes(builder.wrapperModule)) {
      setBuilder((previous) => ({ ...previous, wrapperModule: wrapperModules[0] }));
    }
  }, [builder.wrapperModule, builder.wrapperProject, wrapperModules, wrapperProjects]);

  useEffect(() => {
    if (!hasWrapperSection && activeSection === 5) {
      setActiveSection(4);
    }
  }, [activeSection, hasWrapperSection]);

  const selectProfile = (profileName: string) => {
    const profile = profileByName.get(profileName);
    if (!profile) return;

    setBuilder((previous) => applyProfileDefaults(previous, profile));
    setActiveAvailableCommand('');
    setActiveIncludedCommand(profile.config.required_commands[0] ?? '');
    setBuildLogs((previous) => [...previous, `[+] Active config: ${profile.configPath}`]);
  };

  const addCommand = (command: string) => {
    if (!command || selectedCommandSet.has(command)) return;

    setBuilder((previous) => ({
      ...previous,
      selectedCommands: config.commands.filter((option) => option === command || previous.selectedCommands.includes(option)),
    }));
    setActiveAvailableCommand('');
    setActiveIncludedCommand(command);
  };

  const addAllCommands = () => {
    setBuilder((previous) => ({
      ...previous,
      selectedCommands: [...config.commands],
    }));
    setActiveAvailableCommand('');
    setActiveIncludedCommand(config.commands[0] ?? '');
  };

  const removeCommand = (command: string) => {
    if (!command || requiredCommandSet.has(command)) return;

    setBuilder((previous) => ({
      ...previous,
      selectedCommands: previous.selectedCommands.filter((selectedCommand) => selectedCommand !== command),
    }));
    setActiveIncludedCommand('');
    setActiveAvailableCommand(command);
  };

  const removeOptionalCommands = () => {
    const requiredCommands = config.commands.filter((command) => requiredCommandSet.has(command));
    setBuilder((previous) => ({
      ...previous,
      selectedCommands: requiredCommands,
    }));
    setActiveIncludedCommand(requiredCommands[0] ?? '');
    setActiveAvailableCommand('');
  };

  const submitBuildRequest = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedProfile) {
      alert('Select an agent profile first.');
      return;
    }

    if (!config.profile_id) {
      alert('The selected profile config is missing profile_id, so request cannot be sent.');
      return;
    }

    const requiredSections: SectionNumber[] = hasWrapperSection ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
    if (requiredSections.some((section) => !completed[section])) {
      alert('Complete all required sections before building.');
      return;
    }

    const profileID = config.profile_id;
    const agentProfile = builder.agentProfile;
    const architecture = builder.architecture;
    const os = builder.operatingSystem;
    const language = builder.language;
    const wrapper = selectedWrapperPath;
    const commands = [...builder.selectedCommands];
    const requiredCommands = [...config.required_commands];
    const listener = builder.listener;
    const host = builder.listenerHost?.trim() ?? '';
    const port = builder.listenerPort?.trim() ?? '';
    const useAES = builder.useAES ? 1 : 0;
    const outputType = builder.outputType;
    const outputFileName = buildOutputFileName(builder.outputFileName, builder.outputType);
    const wrapperArgs = buildWrapperArgsJSON(wrapperArgNames, builder.wrapperArgValues);

    const buildRequest: BuildAgentRequest = {
      profileID,
      agentProfile,
      architecture,
      os,
      language,
      wrapper,
      commands,
      requiredCommands,
      listener,
      host,
      port,
      useAES,
      outputType,
      outputFileName,
      wrapperArgs,
    };

    setIsBuilding(true);
    setBuildLogs([
      '[*] Build request prepared',
      `[+] Profile ID: ${buildRequest.profileID}`,
      `[+] Profile: ${buildRequest.agentProfile}`,
      `[+] Architecture: ${buildRequest.architecture}`,
      `[+] Listener: ${buildRequest.listener}`,
      `[+] Callback Host: ${buildRequest.host || '(unset)'}`,
      `[+] Callback Port: ${buildRequest.port || '(unset)'}`,
      `[+] AES: ${buildRequest.useAES === 1 ? 'enabled' : 'disabled'}`,
      `[+] Commands: ${buildRequest.commands.join(', ')}`,
      `[+] Output: ${buildRequest.outputFileName}`,
      ...(wrapper ? [`[+] Wrapper: ${wrapper}`, `[+] Wrapper Args: ${buildRequest.wrapperArgs}`] : []),
      `[*] POST ${BUILD_AGENT_ENDPOINT}`,
    ]);

    try {
      const httpResponse = await fetch(BUILD_AGENT_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequest),
      });

      const contentType = httpResponse.headers.get('content-type') ?? '';
      const response = (contentType.includes('application/json')
        ? await httpResponse.json()
        : { error: await httpResponse.text() }) as BuildAgentResponse;
      const responseLogs = normalizeLogs(response.logs);

      setBuildLogs((previous) => [
        ...previous,
        ...responseLogs,
        ...(response.message ? [`[+] ${response.message}`] : []),
        ...(response.error ? [`[ERROR] ${response.error}`] : []),
        ...(httpResponse.ok ? ['[SUCCESS] Build request completed'] : []),
      ]);

      if (!httpResponse.ok) return;

      onFileCreated({
        id: Date.now(),
        name: response.outputFileName ?? outputFileName,
        path: response.outputPath ?? `${COMPILED_PAYLOADS_ROOT}/${outputFileName}`,
        sizeBytes: 0,
        baseUrl: '',
        url: '',
      });
    } catch (error) {
      setBuildLogs((previous) => [...previous, `[ERROR] ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setIsBuilding(false);
    }
  };

  if (isLoadingProfiles && profiles.length === 0) {
    return (
      <div className="max-h-[100dvh] overflow-y-auto overscroll-contain p-10">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-md border border-white/10 bg-[#2f3b45] p-8 text-center text-sm text-slate-300">
            Loading agent profiles...
          </div>
        </div>
      </div>
    );
  }

  if (loadError && profiles.length === 0) {
    return (
      <div className="max-h-[100dvh] overflow-y-auto overscroll-contain p-10">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-md border border-red-500/40 bg-[#2f3b45] p-8">
            <h2 className="text-2xl font-semibold text-white">Agent Builder</h2>
            <p className="mt-3 text-sm text-red-200">{loadError}</p>
            <p className="mt-3 font-mono text-xs text-slate-400">
              Backend should read: {AGENT_PROFILES_ROOT}/&lt;PROFILE&gt;/config.json
            </p>
            <button
              type="button"
              onClick={() => void loadProfiles(builder.agentProfile)}
              className="mt-6 rounded-md bg-[#79cef2] px-5 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#5fbde6]"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submitBuildRequest} className="mx-auto h-[100dvh] max-w-7xl overflow-y-auto overscroll-contain p-6 pb-24 lg:p-10">
      <Stepper activeSection={activeSection} completed={completed} onSelect={setActiveSection} hasWrapperSection={hasWrapperSection} />

      <div className="mb-7">
        <h2 className="text-5xl font-light tracking-normal text-white">Build Agent</h2>
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.22em] text-slate-500">{selectedProfile?.configPath}</p>
        {config.profile_id && <p className="mt-2 font-mono text-xs text-slate-500">Profile ID: {config.profile_id}</p>}
      </div>

      <div className="grid grid-cols-1 gap-6">
        {activeSection === 1 && (
          <BuilderSection number={1} title="Profile And Architecture" active complete={completed[1]}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <SelectField
                label="Agent Profile"
                options={profiles.map((profile) => ({ label: profile.name, value: profile.name }))}
                value={builder.agentProfile}
                onChange={selectProfile}
              />
              <SelectField
                label="Architecture"
                options={config.architectures.map((architecture) => ({ label: architecture, value: architecture }))}
                value={builder.architecture}
                onChange={(value) => setBuilderValue('architecture', value)}
              />
              <SelectField
                label="Operating System"
                options={config.os.map((operatingSystem) => ({ label: operatingSystem, value: operatingSystem }))}
                value={builder.operatingSystem}
                onChange={(value) => setBuilderValue('operatingSystem', value)}
              />
              <SelectField
                label="Language"
                options={config.languages.map((language) => ({ label: language, value: language }))}
                value={builder.language}
                onChange={(value) => setBuilderValue('language', value)}
              />
              <div>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Wrapper Project</span>
                  <select
                    value={builder.wrapperProject}
                    onChange={(e) => setBuilderValue('wrapperProject', e.target.value)}
                    disabled={wrapperProjects.length === 0}
                    className="h-12 w-full rounded-md border border-white/10 bg-[#202832] px-4 text-sm font-bold text-white outline-none transition-all focus:border-[#79cef2] disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    <option value="">No wrapper</option>
                    {wrapperProjects.map((wp) => (
                      <option key={wp} value={wp}>{wp}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Wrapper Module</span>
                  <select
                    value={builder.wrapperModule}
                    onChange={(event) => setBuilderValue('wrapperModule', event.target.value)}
                    disabled={!builder.wrapperProject || wrapperModules.length === 0}
                    className="h-12 w-full rounded-md border border-white/10 bg-[#202832] px-4 text-sm font-mono text-white outline-none transition-all focus:border-[#79cef2] disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    <option value="">No module</option>
                    {wrapperModules.map((moduleName) => (
                      <option key={moduleName} value={moduleName}>{moduleName}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveSection(2)}
                className="rounded-md bg-[#79cef2] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#5fbde6]"
              >
                Next
              </button>
            </div>
          </BuilderSection>
        )}

        {activeSection === 2 && (
          <BuilderSection number={2} title="Build Commands Into Agent" active complete={completed[2]}>
            <div className="grid grid-cols-1 items-center gap-5 lg:grid-cols-[minmax(0,1fr)_80px_minmax(0,1fr)]">
              <CommandList
                title="Available Commands"
                commands={availableCommands}
                activeCommand={activeAvailableCommand}
                selectedCommands={selectedCommandSet}
                requiredCommands={requiredCommandSet}
                onCommandClick={(command) => {
                  setActiveAvailableCommand(command);
                  setActiveIncludedCommand('');
                }}
                included={false}
              />

              <div className="flex flex-row justify-center gap-3 lg:flex-col">
                <button
                  type="button"
                  onClick={addAllCommands}
                  disabled={availableCommands.length === 0}
                  className="h-10 rounded-md border border-white/20 px-4 font-black text-slate-300 hover:border-[#79cef2] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  &gt;&gt;
                </button>
                <button
                  type="button"
                  onClick={() => addCommand(activeAvailableCommand)}
                  disabled={!activeAvailableCommand}
                  className="h-10 rounded-md border border-white/20 px-4 font-black text-slate-300 hover:border-[#79cef2] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  &gt;
                </button>
                <button
                  type="button"
                  onClick={() => removeCommand(activeIncludedCommand)}
                  disabled={!activeIncludedCommand || requiredCommandSet.has(activeIncludedCommand)}
                  className="h-10 rounded-md border border-white/20 px-4 font-black text-slate-300 hover:border-[#79cef2] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  &lt;
                </button>
                <button
                  type="button"
                  onClick={removeOptionalCommands}
                  disabled={includedCommands.every((command) => requiredCommandSet.has(command))}
                  className="h-10 rounded-md border border-white/20 px-4 font-black text-slate-300 hover:border-[#79cef2] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  &lt;&lt;
                </button>
              </div>

              <CommandList
                title="Commands Included"
                commands={includedCommands}
                activeCommand={activeIncludedCommand}
                selectedCommands={selectedCommandSet}
                requiredCommands={requiredCommandSet}
                onCommandClick={(command) => {
                  setActiveIncludedCommand(command);
                  setActiveAvailableCommand('');
                }}
                included
              />
            </div>

            <div className="mt-5 rounded-md border border-white/10 bg-[#303d47] shadow-lg shadow-black/20">
              <div className="flex items-center justify-between border-b border-[#79cef2] px-5 py-4">
                <h4 className="text-2xl font-light text-white">{focusedCommand || 'Command Details'}</h4>
                <button
                  type="button"
                  className="rounded-md bg-[#79cef2] px-5 py-2 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#5fbde6]"
                >
                  Documentation
                </button>
              </div>
              <div className="space-y-3 px-5 py-4 text-sm text-slate-200">
                <p>
                  <span className="font-bold text-white">Information:</span> {focusedCommandInfo.information}
                </p>
                {focusedCommand && (
                  <>
                    <p>
                      <span className="font-bold text-white">Commandline Help:</span> {focusedCommandInfo.commandlineHelp}
                    </p>
                    <p>
                      <span className="font-bold text-white">Needs Admin Permissions:</span> {focusedCommandInfo.needsAdminPermissions}
                    </p>
                    <p>
                      <span className="font-bold text-white">Description:</span> {focusedCommandInfo.description}
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <button type="button" onClick={() => setActiveSection(1)} className="px-4 py-3 text-sm font-bold uppercase tracking-wide text-[#79cef2]">
                Back
              </button>
              <button
                type="button"
                onClick={() => setActiveSection(3)}
                className="rounded-md bg-[#79cef2] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#5fbde6]"
              >
                Next
              </button>
            </div>
          </BuilderSection>
        )}

        {activeSection === 3 && (
          <BuilderSection number={3} title="Listener" active complete={completed[3]}>
            <ChoiceGrid label="Supported Listener" options={config.supported_listeners} value={builder.listener} onSelect={(value) => setBuilderValue('listener', value)} />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mt-4">
              <label className="block">
                <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Callback Host / Domain</span>
                <input
                  type="text"
                  value={builder.listenerHost ?? ''}
                  onChange={(e) => setBuilderValue('listenerHost', e.target.value)}
                  placeholder="e.g. 10.0.0.1 or example.com"
                  className="h-12 w-full rounded-md border border-white/10 bg-[#202832] px-4 text-sm font-mono text-white outline-none transition-all focus:border-[#79cef2]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Callback Port</span>
                <input
                  type="text"
                  value={builder.listenerPort ?? ''}
                  onChange={(e) => setBuilderValue('listenerPort', e.target.value)}
                  placeholder="e.g. 8080"
                  className="h-12 w-full rounded-md border border-white/10 bg-[#202832] px-4 text-sm font-mono text-white outline-none transition-all focus:border-[#79cef2]"
                />
              </label>
            </div>
            <label className="mt-5 flex cursor-pointer items-center justify-between gap-4 rounded-md border border-white/10 bg-[#202832] px-4 py-4 text-sm text-slate-200 hover:border-[#79cef2]/70">
              <span>
                <span className="block font-bold text-white">Use AES Encryption</span>
                <span className="mt-1 block text-xs text-slate-400">Send useAES as {builder.useAES ? '1' : '0'} in the compile request.</span>
              </span>
              <input
                type="checkbox"
                checked={builder.useAES}
                onChange={(event) => setBuilderValue('useAES', event.target.checked)}
                className="h-5 w-5 accent-[#79cef2]"
              />
            </label>
            <div className="mt-6 flex justify-between">
              <button type="button" onClick={() => setActiveSection(2)} className="px-4 py-3 text-sm font-bold uppercase tracking-wide text-[#79cef2]">
                Back
              </button>
              <button
                type="button"
                onClick={() => setActiveSection(4)}
                className="rounded-md bg-[#79cef2] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#5fbde6]"
              >
                Next
              </button>
            </div>
          </BuilderSection>
        )}

        {hasWrapperSection && activeSection === 4 && (
          <BuilderSection number={4} title="Wrapper Parameters" active complete={completed[4]}>
            {wrapperArgNames.length === 0 ? (
              <div className="rounded-md border border-white/10 bg-[#202832] px-4 py-3 text-sm text-slate-300">
                No wrapper parameters are defined for {`${builder.wrapperProject}/${builder.wrapperModule}`}.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {wrapperArgNames.map((argName) => {
                  const requiredSpec = selectedWrapperModuleSpec?.required ?? {};
                  const values = Array.isArray(requiredSpec[argName]) ? (requiredSpec[argName] as unknown[]).map(String) : null;
                  const isRequired = requiredWrapperArgs.has(argName);

                  // Special-case: if this arg is an injection filename, filter by architecture if possible
                  const filteredValues = values
                    ? values.filter((v) => {
                        if (!builder.architecture) return true;
                        const archAliases = [
                          builder.architecture,
                          builder.architecture.replace('aarch64', 'arm64'),
                          builder.architecture.replace('x86_64', 'x64'),
                        ];
                        return archAliases.some((alias) => alias && v.includes(alias));
                      })
                    : null;

                  if (filteredValues && filteredValues.length > 0) {
                    return (
                      <label key={argName} className="block">
                        <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                          {argName}
                          {isRequired && <span className="ml-2 text-[#79cef2]">Required</span>}
                        </span>
                        <select
                          value={builder.wrapperArgValues[argName] ?? ''}
                          onChange={(e) =>
                            setBuilder((previous) => ({
                              ...previous,
                              wrapperArgValues: { ...previous.wrapperArgValues, [argName]: e.target.value },
                            }))
                          }
                          className="h-12 w-full rounded-md border border-white/10 bg-[#202832] px-4 text-sm font-mono text-white outline-none transition-all focus:border-[#79cef2]"
                        >
                          <option value="">(select)</option>
                          {filteredValues.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                    );
                  }

                  return (
                    <label key={argName} className="block">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                        {argName}
                        {isRequired && <span className="ml-2 text-[#79cef2]">Required</span>}
                      </span>
                      <input
                        type="text"
                        value={builder.wrapperArgValues[argName] ?? ''}
                        onChange={(event) =>
                          setBuilder((previous) => ({
                            ...previous,
                            wrapperArgValues: {
                              ...previous.wrapperArgValues,
                              [argName]: event.target.value,
                            },
                          }))
                        }
                        className="h-12 w-full rounded-md border border-white/10 bg-[#202832] px-4 font-mono text-sm text-white outline-none transition-all focus:border-[#79cef2]"
                        placeholder={isRequired ? 'Required' : 'Optional'}
                      />
                    </label>
                  );
                })}
              </div>
            )}
            <p className="mt-4 font-mono text-xs text-slate-400">Values are optional. Valid JSON values are parsed as JSON; other input is sent as a string. Required/optional fields are determined by the selected wrapper module spec.</p>
            <div className="mt-6 flex justify-between">
              <button type="button" onClick={() => setActiveSection(3)} className="px-4 py-3 text-sm font-bold uppercase tracking-wide text-[#79cef2]">
                Back
              </button>
              <button
                type="button"
                onClick={() => setActiveSection(5)}
                className="rounded-md bg-[#79cef2] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#5fbde6]"
              >
                Next
              </button>
            </div>
          </BuilderSection>
        )}

        {((hasWrapperSection && activeSection === 5) || (!hasWrapperSection && activeSection === 4)) && (
          <BuilderSection number={outputSection} title="Output" active complete={completed[outputSection]}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChoiceGrid label="File Type" options={config.payload_output} value={builder.outputType} onSelect={(value) => setBuilderValue('outputType', value)} />
              <div>
                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">File Name</div>
                <input
                  type="text"
                  value={builder.outputFileName}
                  onChange={(event) => setBuilderValue('outputFileName', event.target.value)}
                  className="h-12 w-full rounded-md border border-white/10 bg-[#202832] px-4 font-mono text-sm text-white outline-none focus:border-[#79cef2]"
                  placeholder={DEFAULT_OUTPUT_NAME}
                />
                <div className="mt-2 break-all font-mono text-[11px] text-slate-500">
                  {COMPILED_PAYLOADS_ROOT}/{buildOutputFileName(builder.outputFileName, builder.outputType)}
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-between">
              <button type="button" onClick={() => setActiveSection(hasWrapperSection ? 4 : 3)} className="px-4 py-3 text-sm font-bold uppercase tracking-wide text-[#79cef2]">
                Back
              </button>
              <button
                type="submit"
                disabled={isBuilding || !completed[1] || !completed[2] || !completed[3] || !completed[4] || !completed[outputSection]}
                className="rounded-md bg-[#79cef2] px-7 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#5fbde6] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isBuilding ? 'Building' : 'Build'}
              </button>
            </div>
          </BuilderSection>
        )}

        <aside className="rounded-md border border-white/10 bg-black p-5">
          <h3 className="mb-4 text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">Request Log</h3>
          <div className="max-h-72 min-h-36 overflow-y-auto rounded-md bg-[#050507] p-4 font-mono text-xs leading-5 text-emerald-500">
            {buildLogs.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-slate-700">No requests yet</div>
            ) : (
              buildLogs.map((log, index) => (
                <div
                  key={`${index}-${log.slice(0, 32)}`}
                  className={
                    log.includes('[ERROR]')
                      ? 'text-red-300'
                      : log.includes('[WARN]')
                        ? 'text-amber-300'
                        : log.includes('[SUCCESS]')
                          ? 'font-bold text-emerald-300'
                          : 'text-emerald-500'
                  }
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </form>
  );
};

export default PayloadsView;
