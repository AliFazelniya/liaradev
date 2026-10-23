export interface ProjectSummary {
  _id: string;
  project_id: string; // the app name
  type: string; // platform: node, django, static, ...
  status: string; // RUNNING | SHUTDOWN | ...
  scale: number;
  planID: string;
  created_at: string;
  isDeployed: boolean;
  bundlePlanID?: string;
  network?: { _id: string; name: string };
}

export interface ProjectDetail extends ProjectSummary {
  envs: { key: string; value: string; encrypted?: boolean }[];
  zeroDowntime?: boolean;
  defaultSubdomain?: boolean;
  hourlyPrice?: number;
  reservedDiskSpace?: number;
}

export interface LogEntry {
  type: string;
  datetime: string;
  message: string;
  release?: string; // release id the line came from
}

export interface MetricPoint {
  value: [number, string | number];
}

export interface ProjectEvent {
  status: string; // container lifecycle: create | start | kill | die | oom | stop | destroy
  time: number; // unix seconds
  release?: string;
}

export interface Release {
  id: string;
  state: string; // QUEUED | BUILDING | PUSHING | DEPLOYING | READY | FAILED | UNHEALTHY | CANCELED | TIMEDOUT
  type: string;
  createdAt: string;
  current: boolean;
  port: number | null;
  finishedAt?: string | null;
  platform?: string;
  buildLocation?: string;
  client?: string;
  sourceAvailable?: boolean;
}

export interface BuildInfo {
  releaseID: string;
  state: string;
  failReason: string | null;
  queue: number | null;
  lines: { stream: string; line: string; at: string }[];
}

export interface PlanBundle {
  id: string; // basic | standard | pro  (console: پایه | نقره‌ای | طلایی)
  label: string;
  hourly: number; // toman/hour for plan + bundle
  monthly: number; // toman/month for plan + bundle (before 10% VAT)
}

export interface PlanInfo {
  id: string; // e.g. small-g2
  name: string; // console name: زمین، مریخ، ...
  bundleID: string; // cheapest available bundle
  price: number; // toman/hour (plan + cheapest bundle)
  monthly: number; // toman/month (plan + cheapest bundle) — verified against the console's price table
  volume: number; // disk GB
  ramGB: number;
  cpu: number;
  shared: boolean;
  available: boolean;
  bundles: PlanBundle[];
}

export interface Metrics {
  cpu: number[]; // % of ONE core (100 = one full core), oldest -> newest
  memory: number[]; // MB samples
}

export interface DbPlan { id: string; types: string[]; ramGB: number; volumeGB: number; hourlyToman: number; bundles: { id: string; monthlyToman: number }[] }
export interface DbInfo { id: string; hostname: string; type: string; version: string; status: string; planID: string; internalPort: number; username: string; password: string; network?: string }

export interface LiaraProvider {
  getDbCatalog(): Promise<{ plans: DbPlan[]; versions: Record<string, { label: string; value: string }[]> }>;
  createDatabase(input: { hostname: string; type: string; version: string; planID: string; bundlePlanID: string; network: string }): Promise<string>;
  getDatabase(id: string): Promise<DbInfo>;
  listDatabases(): Promise<DbInfo[]>;
  deleteDatabase(id: string): Promise<void>;
  listProjects(): Promise<ProjectSummary[]>;
  getProject(name: string): Promise<ProjectDetail>;
  createProject(input: { name: string; planID: string; platform: string; bundlePlanID?: string; network?: string }): Promise<void>;
  checkName(name: string): Promise<boolean>;
  listNetworks(): Promise<{ _id: string; name: string; projectCount?: number }[]>;
  createNetwork(name: string): Promise<{ _id: string }>;
  deleteProject(name: string): Promise<void>;
  turnProject(name: string, on: boolean): Promise<void>;
  restartProject(name: string): Promise<void>;
  updateEnvs(name: string, envs: { key: string; value: string }[]): Promise<void>;
  changePlan(name: string, planID: string, bundlePlanID?: string): Promise<void>;
  getLogs(name: string, sinceSeconds: number): Promise<LogEntry[]>;
  getMetrics(name: string): Promise<Metrics>;
  getEvents(name: string): Promise<ProjectEvent[]>;
  updatePort(name: string, port: number): Promise<void>;
  rollbackRelease(releaseID: string): Promise<void>;
  getReleaseSource(releaseID: string): Promise<Uint8Array>;
  setFlag(name: string, flag: "zero-downtime" | "read-only" | "fixed-ip" | "default-subdomain", on: boolean): Promise<void>;
  getSeries(name: string, kind: "cpu" | "memory" | "network-receive" | "network-transmit", sinceSeconds: number): Promise<{ t: number; v: number }[]>;
  getSummary(name: string): Promise<{ cpuCores: number | null; memBytes: number | null }>;
  listDisks(name: string): Promise<any[]>;
  listDomains(name: string): Promise<any[]>;
  getMe(): Promise<{ fullname: string; avatar?: string }>;
  getBalance(): Promise<{ team: number | null; user: number }>;
  getReleases(name: string): Promise<Release[]>;
  getBuild(releaseID: string): Promise<BuildInfo>;
  getPlans(): Promise<PlanInfo[]>;
  deploySource(name: string, tarGz: Uint8Array, opts: { port: number; platform: string; extra?: Record<string, unknown> }): Promise<{ sourceID: string; releaseID: string }>;
}

export class LiaraError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}
