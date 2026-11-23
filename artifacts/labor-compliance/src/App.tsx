import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { shadcn } from '@clerk/themes';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { RowNumberedTable } from '@/components/RowNumberedTable';
import { RecordRowActions } from '@/components/RecordRowActions';
import { ContractorSelectWithAdd } from '@/components/ContractorSelectWithAdd';
import { CommentsPopover } from '@/components/CommentsPopover';
import {
  Activity, ArrowLeft, ArrowUpRight, BriefcaseBusiness, Building2, Check, ChevronRight, ClipboardCheck, History,
  Database, Download, FileClock, FileText, HardHat, LayoutDashboard, LockKeyhole, LogOut, Plus, RefreshCw, Search,
  ShieldCheck, SlidersHorizontal, WalletCards, X, FileSearch, ChevronDown, Trash2,
} from 'lucide-react';
import {
  queryDatabaseTableRows, useCreateContractor, useCreateProject,
  getGetReferenceOnlyQueryKey, getGetWorkbookSheetRowsQueryKey, useGetReferenceOnly, useCreateWithholding, useGetDatabaseTables, useGetWorkbookSheetRows,
  useGetWorkspace, useHealthCheck, useUpdateDatabaseTableRow,
  useUpdateContractor, useUpdateProject, useUpdateWithholding,
  useGetRecordHistory,
  useUpdateContractorSubcontractorLink,
  useMoveRecordToTrash,
} from '@workspace/api-client-react';
import type {
  Contractor, ContractorInput, ContractorUpdate, DatabaseTable, Project, ProjectInput, ProjectUpdate,
  TrashRecordType,
  DatabaseRowUpdate, ReferenceOnlyProject, ReferenceOnlyRelatedRecord, ReferenceOnlySourceRow,
  Withholding, WithholdingInput, WithholdingUpdate, WorkbookSheetRow,
} from '@workspace/api-client-react';
import {
  getActiveFederalProjectDisplay,
  hasConflictingActiveFederalSourceIdentity,
  isFederalProjectName,
  joinActiveFederalRows,
  parseActiveFederalSourceRows,
  stripFederalProjectSuffix,
  type ActiveFederalTableRow,
} from './lib/activeFederalProjects';
import { coerceFields, DIR_NUMBER_PATTERN, formatProjectNumberForDisplay, isValidDirNumber, projectCodeFormats } from './lib/projectForm';
import { groupContractorProjects, sortContractorProjectGroups, type ContractorProjectSortOrder } from './lib/contractorProjectGroups';
import { incompleteSubcontractorsFirst } from './lib/subcontractorOrder';
import { buildSubcontractorDirectory } from './lib/subcontractorDirectory';
import { auditContractorRelationships, type WorkbookContractorRelationship } from './lib/contractorRelationshipAudit';
import { sortRows, type SortOption } from './lib/sorting';
import { SortByControl } from './components/SortByControl';
import { RequiredFieldLabel, RequiredFieldsNote } from './components/RequiredFieldLabel';
import { RestitutionsPage } from './pages/RestitutionsPage';
import { TrashPage } from './pages/TrashPage';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const isPublishedPublicMode = import.meta.env.PROD;
const clerkPubKey = isPublishedPublicMode ? '' : publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
type DatabaseEditRequest = {
  schemaName: string;
  tableName: string;
  key: Record<string, unknown>;
  initialRow: Record<string, unknown>;
  editor?: 'activeFederalSource';
  notice?: string;
};
const DatabaseEditorContext = createContext<(request: DatabaseEditRequest) => void>(() => {});
function useOpenDatabaseEditor() {
  return useContext(DatabaseEditorContext);
}
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
if (!isPublishedPublicMode && !clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const appearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#29435a', colorForeground: '#263b4d', colorMutedForeground: '#727d80', colorDanger: '#a34d3d',
    colorBackground: '#fbfaf6', colorInput: '#fffefa', colorInputForeground: '#263b4d', colorNeutral: '#dcd5c8',
    fontFamily: 'DM Sans', borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fbfaf6] rounded-xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#263b4d] font-bold', headerSubtitle: 'text-[#727d80]', socialButtonsBlockButtonText: 'text-[#263b4d]',
    formFieldLabel: 'text-[#43545d]', footerActionLink: 'text-[#29435a]', footerActionText: 'text-[#727d80]',
    dividerText: 'text-[#727d80]', identityPreviewEditButton: 'text-[#29435a]', formFieldSuccessText: 'text-[#397553]',
    alertText: 'text-[#934e40]', logoBox: 'mb-3', logoImage: 'max-h-10', socialButtonsBlockButton: 'border-[#dcd5c8]',
    formButtonPrimary: 'bg-[#29435a] hover:bg-[#36576e]', formFieldInput: 'border-[#dcd5c8] bg-[#fffefa]',
    footerAction: 'text-[#727d80]', dividerLine: 'bg-[#e5dfd2]', alert: 'border-[#ecd1c8]', otpCodeFieldInput: 'border-[#dcd5c8]',
    formFieldRow: 'mb-4', main: 'gap-4',
  },
};

type Kind = 'project' | 'contractor' | 'withholding';
type FormField = {
  key: string; label: string; type?: string; full?: boolean; options?: string[]; required?: boolean; sectionBefore?: string;
  keepStatusDate?: boolean; keepPwcDates?: boolean;
};
const missingFormsLabel = 'Projects with missing forms';
const allFormsLabel = 'Projects with all forms';
const notTrackedFormsLabel = 'Not tracked';
const CommentsPreview = CommentsPopover;
const projectEntryFields: FormField[] = [
  { key: 'projectName', label: 'Proj Name:', full: true, required: true },
  { key: 'projectNumber', label: 'Proj Num:', type: 'projectCode', full: true },
  { key: 'projectFlags', label: 'Project Type', type: 'projectFlags', full: true },
  { key: 'dirNumber', label: 'DIR#:', type: 'dirNumber', full: true },
  { key: 'contractorId', label: 'Primary Contractor', type: 'contractor', full: true },
  { key: 'registrationStatus', label: 'LCP:', type: 'lcpStatus', full: true, required: true },
  { key: 'payrollFormsStatus', label: 'DIR:', type: 'dirStatus', full: true, required: true },
  { key: 'projectInitiationDate', label: 'Date of project initiation:', type: 'date' },
  { key: 'projectFinishDate', label: 'Date of project finish:', type: 'date' },
  { key: 'pwc100', label: 'On PWC-100?', type: 'pwc100', full: true },
  { key: 'complianceNotes', label: 'Comments', type: 'textarea', full: true },
];
const onCallProjectEntryFields: FormField[] = [
  ...projectEntryFields.slice(0, 2),
  { key: 'primeApprover', label: 'Prime Approver', full: true },
  ...projectEntryFields.slice(2),
];
const activeFederalProjectAddFields: FormField[] = [
  { key: 'projectName', label: 'Federal Projects as of 1/10/2024', full: true, required: true },
  { key: 'projectNumber', label: 'Project #', type: 'projectCode', full: true },
  { key: 'projectFlags', label: 'Project Type', type: 'projectFlags', full: true },
  { key: 'dirNumber', label: 'DIR #', type: 'dirNumberEither' },
  { key: 'contractorId', label: 'Primary Contractor', type: 'contractor', full: true },
  { key: 'federalProjectNumber', label: 'Federal Project No.' },
  { key: 'davisBaconDetermination', label: 'Davis-Bacon General Determination (Mod # & effective Date)', full: true },
  { key: 'federalSetupInLcp', label: 'Project set-up as Federal in LCP?' },
  { key: 'federalNotes', label: 'Notes', type: 'textarea', full: true },
  { key: 'federalActive', label: 'Active' },
];
const projectFields: FormField[] = [
  ...projectEntryFields.filter((field) => field.key !== 'dirNumber').map((field) => ({
    ...field,
    ...(field.type === 'lcpStatus' || field.type === 'dirStatus' ? { keepStatusDate: true } : {}),
    ...(field.type === 'pwc100' ? { keepPwcDates: true } : {}),
  })),
  { key: 'dirNumber', label: 'DIR #', type: 'dirNumberEither' },
  { key: 'designProjectManager', label: 'Design Project Manager', full: true },
  { key: 'designProjectManagerEmail', label: 'Design Project Manager Email', type: 'email', full: true },
  { key: 'designWeekStart', label: 'Design Week Start', type: 'date' },
  { key: 'designWeekEnd', label: 'Design Week End', type: 'date' },
  { key: 'designPwcrExpirationDate', label: 'PWCR Expiration Date', type: 'date' },
  { key: 'primeApprover', label: 'Prime Approver', full: true },
  { key: 'federalProjectNumber', label: 'Federal Project No.' },
  { key: 'davisBaconDetermination', label: 'Davis-Bacon General Determination (Mod # & effective Date)', full: true },
  { key: 'federalSetupInLcp', label: 'Project set-up as Federal in LCP?' },
  { key: 'federalNotes', label: 'Federal Notes', type: 'textarea', full: true },
  { key: 'federalActive', label: 'Active' },
  { key: 'formsStatus', label: 'Forms status', options: [notTrackedFormsLabel, missingFormsLabel, allFormsLabel] },
  ...[1, 2, 3, 4].map((number) => ({
    key: `form${number}Status`,
    label: `Form ${number} status`,
    type: 'formStatus',
    options: ['Not tracked', 'Not checked', 'Complete', 'Missing'],
  })),
];
const activeFederalAppFieldKeys = [
  'federalProjectNumber',
  'davisBaconDetermination',
  'federalSetupInLcp',
  'federalNotes',
  'federalActive',
] as const;
const contractorAddFields: FormField[] = [{ key: 'name', label: 'Contractor Name', full: true, required: true }];
const contractorEditFields: FormField[] = [
  { key: 'name', label: 'Contractor name', full: true, required: true },
  { key: 'aliases', label: 'Aliases', type: 'textarea', full: true },
];
const contractorProjectTypeOptions = [
  { value: 'Federal', label: 'Federal project', enabled: (project: Project) => project.federalProject },
  { value: 'Design', label: 'Design project', enabled: (project: Project) => project.designProject },
  { value: 'On Call', label: 'On call', enabled: (project: Project) => project.onCall },
  { value: 'PAS CIP+DPW', label: 'PAS CIP+DPW', enabled: (project: Project) => project.pasCipDpw },
];
function subContractorProjectTypes(project?: Project) {
  if (!project) return [];
  const selected = contractorProjectTypeOptions.filter((option) => option.enabled(project));
  return selected.length ? selected : contractorProjectTypeOptions;
}
const withholdingFields: FormField[] = [
  { key: 'projectId', label: 'Project', type: 'project' }, { key: 'contractorId', label: 'Primary Contractor', type: 'contractor' },
  { key: 'invoiceReference', label: 'Invoice reference' }, { key: 'amountWithheld', label: 'Amount withheld', type: 'number' },
  { key: 'notificationDate', label: 'Notification date', type: 'date' }, { key: 'notificationDateText', label: 'Notification date (as recorded)' },
  { key: 'reason', label: 'Reason', type: 'textarea', full: true }, { key: 'releaseDate', label: 'Release date', type: 'date' },
  { key: 'releaseDateText', label: 'Release date (as recorded)' }, { key: 'releaseReference', label: 'Release reference' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];

function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function money(value?: number | null) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0)); }
function statusClass(value: string) {
  const text = (value || '').toLowerCase();
  if (text.includes('done') || text.includes('complete') || text.includes('registered') || text.includes('all forms') || text === 'resolved' || text === 'closed' || text === 'yes') return 'status-done';
  if (text.includes('missing') || text.includes('overdue') || text.includes('late') || text === 'open' || text === 'no') return 'status-missing';
  if (text.includes('progress') || text.includes('pending')) return 'status-progress';
  return 'status-neutral';
}
function Status({ value }: { value: string }) { return <span className={`status ${statusClass(value)}`}>{value || 'Not checked'}</span>; }
function ComplianceStatusWithBypass({ value, bypass, bypassStatus }: { value: string; bypass: boolean; bypassStatus: string }) {
  return <div className="compliance-status-display">
    <Status value={value} />
    {bypass && <span className="compliance-bypass-badge">Bypass: {bypassStatus || 'Not selected'}</span>}
  </div>;
}
function alphabetizedContractors(contractors: Contractor[]): Contractor[] {
  return [...contractors].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
}
function Metric({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: string }) {
  return <div className={`panel metric ${tone || ''}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{note && <div className="metric-note">{note}</div>}</div>;
}
type StatusCount = { label: string; count: number };
function StatusCountCard({ title, counts, total }: { title: string; counts: StatusCount[]; total: number }) {
  return <section className="panel status-count-card"><div className="panel-head"><h2 className="panel-title">{title}</h2><span className="panel-kicker">{total} projects</span></div>
    <div className="status-count-list">{counts.map(({ label, count }) => <div className="status-count-row" key={label}><Status value={label} /><strong>{count}</strong></div>)}</div>
  </section>;
}
function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="subheading">{description}</p></div>{action}</div>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><div className="empty-mark"><FileText /></div><strong>{title}</strong><p style={{ margin: '7px 0 0' }}>{detail}</p></div>;
}
const WorkspaceErrorMessageContext = createContext<string | null>(null);
function workspaceQuotaMessage(error: unknown): string | null {
  void error;
  return null;
}
function ErrorBox({ retry }: { retry: () => void }) {
  const message = useContext(WorkspaceErrorMessageContext);
  return <div className="error-state" role="alert"><span>{message || 'Records could not be loaded. Your changes have not been lost.'}</span><button className="btn" onClick={retry}><RefreshCw /> {message ? 'Check access again' : 'Try again'}</button></div>;
}

function Home() {
  return <div className="landing">
    <header className="landing-nav"><div className="brand" style={{ padding: 0 }}><div className="brand-mark"><Building2 size={19} /></div><div><div className="brand-title">Sunnyvale</div><div className="brand-sub">Public Works · Labor Compliance</div></div></div><Link className="btn" href="/sign-in">Staff sign in <ArrowUpRight /></Link></header>
    <main className="landing-content"><section><div className="eyebrow">City of Sunnyvale · Public Works</div><h1>Public work,<br /><em>properly accounted for.</em></h1><p className="landing-copy">A secure workspace for contractor registration, payroll review and payment checks. Find the record. See what is due. Maintain a clear compliance record.</p><div className="landing-actions"><Link className="btn btn-primary" href="/sign-in">Access staff workspace <ChevronRight /></Link><Link className="btn" href="/request-access">Request access</Link></div></section>
      <div className="hero-art" aria-hidden="true"><div className="blueprint"><div className="blueprint-core"><HardHat /></div><div className="orbit-label orbit-one">01 · Contractor registration</div><div className="orbit-label orbit-two">02 · Payroll &amp; forms</div><div className="orbit-label orbit-three">03 · Payment check</div></div></div></main>
    <section className="landing-band"><div className="landing-band-inner"><span className="landing-band-label">Built for public accountability</span><div className="landing-band-item"><ShieldCheck /> Invited staff workspace</div><div className="landing-band-item"><ClipboardCheck /> Traceable compliance records</div><div className="landing-band-item"><FileClock /> Historical records preserved</div></div></section>
    <footer className="landing-footer"><span>City of Sunnyvale · Public Works</span><span>Authorized municipal staff only</span></footer>
  </div>;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Home />;
  return isSignedIn ? <Redirect to="/dashboard" /> : <Home />;
}
function SignInPage() {
  return <div className="landing" style={{ display: 'grid', placeItems: 'center', padding: 20 }}>
    <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
  </div>;
}
function SignUpPage() {
  const query = new URLSearchParams(window.location.search);
  if (!query.has('__clerk_ticket')) return <Redirect to="/request-access" />;
  return <div className="landing" style={{ display: 'grid', placeItems: 'center', padding: 20 }}>
    <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
  </div>;
}
function RequestAccessPage() {
  return <div className="landing" style={{ display: 'grid', placeItems: 'center', padding: 20 }}>
    <section className="panel" style={{ width: 'min(100%, 520px)', padding: 32 }}>
      <div className="eyebrow">Staff workspace</div>
      <h1 style={{ fontSize: 30, margin: '12px 0' }}>Invitation required</h1>
      <p className="landing-copy">This workspace is limited to invited staff. Contact your workspace administrator to request an invitation.</p>
      <Link className="btn btn-primary" href="/sign-in" style={{ marginTop: 18 }}>Return to sign in <ArrowUpRight /></Link>
    </section>
  </div>;
}

const workbookSheetTabs = [
  { href: '/sheets/pas-cip-dpw', label: '1. LCP & DIR - PAS CIP+DPW', icon: BriefcaseBusiness, view: 'projects' },
  { href: '/sheets/design', label: '2. LCP & DIR - DESIGN', icon: BriefcaseBusiness, view: 'projects' },
  { href: '/sheets/on-call-non-pas', label: '3. LCP & DIR - ON CALL NON PAS', icon: BriefcaseBusiness, view: 'projects' },
  { href: '/sheets/active-federal-projects', label: 'Active Federal Projects', icon: BriefcaseBusiness, view: 'projects' },
  { href: '/sheets/withholdings', label: 'Withholdings', icon: WalletCards, view: 'withholdings' },
  { href: '/sheets/info-needed', label: 'Info Needed', icon: BriefcaseBusiness, view: 'projects' },
  { href: '/sheets/sections-to-review', label: 'Sections to Review', icon: FileText, view: 'source' },
] as const;
const currentWorkbookSheetTabs = workbookSheetTabs;
const lcpDirSheetLabels: Record<string, string> = {
  '/sheets/pas-cip-dpw': 'PAS CIP+DPW',
  '/sheets/design': 'DESIGN',
  '/sheets/on-call-non-pas': 'ON CALL NON PAS',
};
const PAS_CIP_DPW_SOURCE_LABEL = workbookSheetTabs.find((tab) => tab.href === '/sheets/pas-cip-dpw')?.label ?? '';
const lcpDirWorkbookTabs = currentWorkbookSheetTabs.filter((tab) => tab.href in lcpDirSheetLabels);
const standaloneWorkbookTabs = currentWorkbookSheetTabs.filter((tab) => !(tab.href in lcpDirSheetLabels));
const workbookTabsAfterLcpDir = standaloneWorkbookTabs;

const UNNAMED_PROJECT_TITLE = '(Project not named)';

function projectComesFromSheet(project: Project, sheetName: string): boolean {
  const raw = project.sourceSheets?.trim();
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.some((value) => value === sheetName);
  } catch {
    // Older source labels may be stored as a delimited text value.
  }
  return raw.split(/[,;|]/).map((value) => value.trim()).includes(sheetName);
}

function projectMatchesTypePage(project: Project, sheetName: string): boolean {
  if (sheetName === PAS_CIP_DPW_SOURCE_LABEL) return project.pasCipDpw;
  if (sheetName === '2. LCP & DIR - DESIGN') return project.designProject;
  if (sheetName === '3. LCP & DIR - ON CALL NON PAS') return project.onCall;
  if (sheetName === 'Active Federal Projects') return project.federalProject;
  return false;
}

function isUnnamedProjectTitle(projectName: string | null | undefined): boolean {
  return (projectName || '').trim().toLowerCase() === UNNAMED_PROJECT_TITLE.toLowerCase();
}

function isUnnamedProject(project: Project): boolean {
  return isUnnamedProjectTitle(project.projectName);
}

function projectReferenceLabel(projectName: string | null | undefined): string {
  return isUnnamedProjectTitle(projectName) ? 'Subs record' : projectName || 'Project not linked';
}

function countProjectStatuses(
  projects: Project[],
  getStatus: (project: Project) => string | null | undefined,
  order: string[],
): StatusCount[] {
  const counts = new Map(order.map((label) => [label, 0]));
  projects.forEach((project) => {
    const rawLabel = getStatus(project)?.trim() || order[0];
    const label = order.find((candidate) => candidate.toLowerCase() === rawLabel.toLowerCase()) || rawLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return Array.from(counts, ([label, count]) => ({ label, count }));
}

function complianceStatusBucket(value?: string | null): 'Not checked' | 'Complete' | 'Missing' {
  const normalized = (value || '').trim().toLowerCase();
  if (['complete', 'registered', 'active', 'yes'].includes(normalized)) return 'Complete';
  if (['missing', 'inactive', 'incomplete', 'in progress', 'no'].includes(normalized)) return 'Missing';
  return 'Not checked';
}

function projectEntryStatusLabel(value?: string | null): '' | 'Complete' | 'Missing' {
  const status = complianceStatusBucket(value);
  return status === 'Not checked' ? '' : status;
}

function formsStatusBucket(value?: string | null): typeof missingFormsLabel | typeof allFormsLabel | typeof notTrackedFormsLabel {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === allFormsLabel.toLowerCase()) return allFormsLabel;
  if (normalized === missingFormsLabel.toLowerCase()) return missingFormsLabel;
  return notTrackedFormsLabel;
}

type NeedsActionTab = 'LCP' | 'DIR' | 'Forms';
const needsActionTabs: NeedsActionTab[] = ['LCP', 'DIR', 'Forms'];

function isMissingStatus(value?: string | null): boolean {
  return complianceStatusBucket(value) !== 'Complete';
}

function needsActionStatusLabel(value?: string | null): string {
  return complianceStatusBucket(value);
}

function ClerkAccountControls() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const initials = (user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || 'S').toUpperCase();
  return <div className="top-actions"><span>{user?.firstName || 'Staff account'}</span><div className="operator">{initials}</div><button className="table-action" data-testid="button-sign-out" aria-label="Sign out" title="Sign out" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut /></button></div>;
}

function DeleteAction({ recordType, id, title, onDelete }: {
  recordType: TrashRecordType;
  id: number;
  title: string;
  onDelete: (recordType: TrashRecordType, id: number, title: string) => void;
}) {
  return <button
    type="button"
    className="table-action table-delete-action"
    aria-label={`Delete ${title}`}
    title="Delete"
    data-testid={`button-delete-${recordType}-${id}`}
    onClick={() => onDelete(recordType, id, title)}
  ><Trash2 aria-hidden="true" /></button>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const isLcpDirRoute = location === '/projects' || lcpDirWorkbookTabs.some((tab) => tab.href === location);
  const [isLcpDirOpen, setLcpDirOpen] = useState(isLcpDirRoute);
  useEffect(() => {
    if (isLcpDirRoute) setLcpDirOpen(true);
  }, [isLcpDirRoute]);
  const renderWorkbookTab = (tab: (typeof currentWorkbookSheetTabs)[number], displayLabel: string = tab.label) => {
    const Icon = tab.icon;
    return <Link key={tab.href} href={tab.href} title={displayLabel} aria-current={location === tab.href ? 'page' : undefined} className={`nav-link sheet-nav-link ${location === tab.href ? 'active' : ''}`}><Icon aria-hidden="true" /><span>{displayLabel}</span></Link>;
  };
  return <div className="app-frame"><aside className="sidebar">
    <Link href="/dashboard" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}><div className="brand-mark"><Building2 size={18} /></div><div><div className="brand-title">Sunnyvale</div><div className="brand-sub">Labor Compliance</div></div></Link>
    <div className="nav-label">Workspace</div><nav aria-label="Workspace">
      <Link href="/dashboard" title="Overview" aria-current={location === '/dashboard' ? 'page' : undefined} className={`nav-link sheet-nav-link ${location === '/dashboard' ? 'active' : ''}`}><LayoutDashboard aria-hidden="true" /><span>Overview</span></Link>
      <Link href="/restitutions" title="Restitution" aria-current={location === '/restitutions' ? 'page' : undefined} className={`nav-link sheet-nav-link ${location === '/restitutions' ? 'active' : ''}`}><WalletCards aria-hidden="true" /><span>Restitution</span></Link>
    </nav>
    <div className="nav-label">Sections</div><nav className="sheet-nav" aria-label="Sections">
      <div className="sheet-nav-group">
        <button type="button" className={`nav-link sheet-nav-link sheet-nav-group-toggle ${isLcpDirRoute ? 'active' : ''}`} aria-expanded={isLcpDirOpen} aria-controls="lcp-dir-pages" onClick={() => setLcpDirOpen((open) => !open)}>
          <BriefcaseBusiness aria-hidden="true" /><span>PROJECTS</span><ChevronRight className="sheet-nav-group-caret" aria-hidden="true" />
        </button>
        {isLcpDirOpen && <div className="sheet-nav-group-menu" id="lcp-dir-pages">
          <Link href="/projects" title="All Projects" aria-current={location === '/projects' ? 'page' : undefined} className={`nav-link sheet-nav-link ${location === '/projects' ? 'active' : ''}`}><BriefcaseBusiness aria-hidden="true" /><span>All Projects</span></Link>
          {lcpDirWorkbookTabs.map((tab) => renderWorkbookTab(tab, lcpDirSheetLabels[tab.href]))}
        </div>}
      </div>
      <Link href="/contractors" title="Contractors" aria-current={location === '/contractors' ? 'page' : undefined} className={`nav-link sheet-nav-link ${location === '/contractors' ? 'active' : ''}`}><Building2 aria-hidden="true" /><span>Contractors</span></Link>
      {workbookTabsAfterLcpDir.map((tab) => renderWorkbookTab(tab))}
    </nav>
    <div className="nav-label">Developer</div><nav aria-label="Developer">
      <Link href="/reference-only" title="Reference Only" aria-current={location === '/reference-only' ? 'page' : undefined} data-testid="link-reference-only" className={`nav-link sheet-nav-link ${location === '/reference-only' ? 'active' : ''}`}><FileSearch aria-hidden="true" /><span>Reference Only</span></Link>
      <Link href="/database" title="SSMS data" aria-current={location === '/database' ? 'page' : undefined} className={`nav-link sheet-nav-link ${location === '/database' ? 'active' : ''}`}><Database aria-hidden="true" /><span>SSMS data</span></Link>
    </nav>
    <nav className="sidebar-trash-nav" aria-label="Deleted records">
      <Link href="/trash" title="Trash" aria-current={location === '/trash' ? 'page' : undefined} className={`nav-link sheet-nav-link ${location === '/trash' ? 'active' : ''}`} data-testid="link-trash"><Trash2 aria-hidden="true" /><span>Trash</span></Link>
    </nav>
    <div className="sidebar-foot">City of Sunnyvale<br />Public Works · Authorized staff</div>
  </aside><div className="workspace"><header className="topbar"><span className="crumb">PUBLIC WORKS <span style={{ color: '#b6aa90' }}>/</span> COMPLIANCE RECORDS</span>{isPublishedPublicMode ? <div className="top-actions" data-testid="status-password-access"><span>Password access</span><div className="operator"><LockKeyhole size={16} aria-hidden="true" /></div></div> : <ClerkAccountControls />}</header><main className="content">{children}</main></div></div>;
}

function TableScrollRegion({ children }: { children: ReactNode }) {
  const regionRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const region = regionRef.current;
    const rail = railRef.current;
    const tableViewport = region?.querySelector<HTMLElement>('.table-wrap');
    if (!region || !rail || !tableViewport) return;

    const updateRailPosition = () => {
      const table = tableViewport.querySelector<HTMLTableElement>('table');
      const rows = table?.tHead ? Array.from(table.tHead.rows) : [];
      const lastRow = rows.at(-1);
      const headerBottom = lastRow
        ? Math.max(...Array.from(lastRow.cells).map((cell) => cell.getBoundingClientRect().bottom))
        : 0;
      const panelRect = tableViewport.getBoundingClientRect();
      const railHeight = rail.offsetHeight || 14;
      const top = headerBottom - railHeight;
      const visible = Boolean(
        table && hasOverflow && panelRect.bottom > top && panelRect.top < window.innerHeight
        && top >= 0 && top + railHeight <= panelRect.bottom,
      );
      rail.style.left = `${panelRect.left + tableViewport.clientLeft}px`;
      rail.style.top = `${top}px`;
      rail.style.width = `${tableViewport.clientWidth}px`;
      rail.style.visibility = visible ? 'visible' : 'hidden';
      rail.style.pointerEvents = visible ? 'auto' : 'none';
    };
    const measure = () => {
      const table = tableViewport.querySelector<HTMLTableElement>('table');
      const width = table ? Math.max(table.scrollWidth, table.offsetWidth) : 0;
      const overflowing = width > tableViewport.clientWidth + 1;
      setContentWidth((current) => current === width ? current : width);
      setHasOverflow((current) => current === overflowing ? current : overflowing);
      tableViewport.classList.toggle('has-horizontal-scroll', overflowing);
      if (table) {
        const maxOffset = `${overflowing ? Math.max(width - tableViewport.clientWidth, 0) : 0}px`;
        if (table.style.getPropertyValue('--table-horizontal-max-offset') !== maxOffset) {
          table.style.setProperty('--table-horizontal-max-offset', maxOffset);
        }
      }
      if (table?.tHead) {
        let stickyTop = 0;
        Array.from(table.tHead.rows).forEach((row) => {
          Array.from(row.cells).forEach((cell) => {
            const stickyCell = cell as HTMLElement;
            const top = `${stickyTop}px`;
            if (stickyCell.style.top !== top) stickyCell.style.top = top;
          });
          stickyTop += row.getBoundingClientRect().height;
        });
        const offset = `${overflowing ? rail.scrollLeft : 0}px`;
        if (table.style.getPropertyValue('--table-horizontal-offset') !== offset) {
          table.style.setProperty('--table-horizontal-offset', offset);
        }
      }
      if (!overflowing) {
        rail.scrollLeft = 0;
      }
      updateRailPosition();
    };
    const syncFromRail = () => {
      const table = tableViewport.querySelector<HTMLTableElement>('table');
      table?.style.setProperty('--table-horizontal-offset', `${rail.scrollLeft}px`);
      updateRailPosition();
    };
    const resizeObserver = new ResizeObserver(measure);
    const mutationObserver = new MutationObserver(measure);
    resizeObserver.observe(tableViewport);
    const table = tableViewport.querySelector('table');
    if (table) {
      resizeObserver.observe(table);
      if (table.tHead) resizeObserver.observe(table.tHead);
    }
    mutationObserver.observe(tableViewport, { childList: true, subtree: true });
    rail.addEventListener('scroll', syncFromRail, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', updateRailPosition, { passive: true });
    measure();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      rail.removeEventListener('scroll', syncFromRail);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', updateRailPosition);
      tableViewport.classList.remove('has-horizontal-scroll');
      tableViewport.querySelector<HTMLTableElement>('table')?.style.removeProperty('--table-horizontal-offset');
      tableViewport.querySelector<HTMLTableElement>('table')?.style.removeProperty('--table-horizontal-max-offset');
    };
  }, [children, hasOverflow]);

  return <div className="table-scroll-region" ref={regionRef}>
    <div
      className={`table-horizontal-rail${hasOverflow ? '' : ' is-hidden'}`}
      ref={railRef}
      role="region"
      aria-label="Horizontal table scroll"
      aria-hidden={!hasOverflow}
      tabIndex={hasOverflow ? 0 : -1}
    >
      <div className="table-horizontal-rail-spacer" style={{ width: contentWidth }} />
    </div>
    {children}
  </div>;
}

function Dashboard({ workspace, loading, error, retry, onAdd, onEdit, onDelete }: { workspace: any; loading: boolean; error: boolean; retry: () => void; onAdd: (kind: Kind) => void; onEdit: (kind: Kind, record: any) => void; onDelete: (recordType: TrashRecordType, id: number, title: string) => void }) {
  const projects: Project[] = (workspace?.projects || []).filter((project: Project) => !isUnnamedProject(project));
  const contractors: Contractor[] = workspace?.contractors || [];
  const federalWorkbookQuery = useGetWorkbookSheetRows('Active Federal Projects', {
    query: { refetchInterval: 60_000, retry: false, refetchOnWindowFocus: true },
  });
  const federalSourceRows = parseActiveFederalSourceRows(federalWorkbookQuery.data ?? []);
  const federalPageProjects = projects.filter((project) =>
    project.federalProject
    || isFederalProjectName(project.projectName)
    || projectComesFromSheet(project, 'Active Federal Projects'),
  );
  const federalRows = joinActiveFederalRows(federalSourceRows, projects, federalPageProjects);
  const federalDisplayByProjectId = new Map<number, ReturnType<typeof getActiveFederalProjectDisplay>>();
  federalRows.forEach((row) => {
    if (row.project && isFederalProjectName(row.project.projectName)) {
      federalDisplayByProjectId.set(row.project.id, getActiveFederalProjectDisplay(row));
    }
  });
  const displayProject = (project: Project) => {
    const federalDisplay = federalDisplayByProjectId.get(project.id);
    const hasFederalSuffix = isFederalProjectName(project.projectName);
    return {
      projectName: federalDisplay?.projectName || (hasFederalSuffix ? stripFederalProjectSuffix(project.projectName) : project.projectName),
      projectNumber: federalDisplay?.projectNumber || (hasFederalSuffix ? formatProjectNumberForDisplay(project.projectNumber || project.projectKey) : project.projectNumber || project.projectKey),
      dirNumber: federalDisplay?.dirNumber || project.dirNumber,
      contractorName: federalDisplay?.contractorName || project.contractorName,
    };
  };
  const summary = workspace?.summary || {};
  const [query, setQuery] = useState('');
  const [contractorFilter, setContractorFilter] = useState('all');
  const [registrationFilter, setRegistrationFilter] = useState('all');
  const [payrollFilter, setPayrollFilter] = useState('all');
  const [formsFilter, setFormsFilter] = useState('all');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [recentSort, setRecentSort] = useState('newest:desc');
  const [needsActionSort, setNeedsActionSort] = useState('newest:desc');
  const [needsActionTab, setNeedsActionTab] = useState<NeedsActionTab>('LCP');
  const [needsActionPage, setNeedsActionPage] = useState(0);
  const [needsActionSearches, setNeedsActionSearches] = useState<Record<NeedsActionTab, string>>({ LCP: '', DIR: '', Forms: '' });
  const [needsActionFilters, setNeedsActionFilters] = useState<Record<NeedsActionTab, string>>({ LCP: 'all', DIR: 'all', Forms: 'all' });
  const refreshedAt = summary.refreshedAt ? new Date(summary.refreshedAt) : null;
  const dataIsStale = !refreshedAt || Date.now() - refreshedAt.getTime() > 5 * 60_000;
  const soon = projects.filter((project) => project.daysUntilDue !== null && project.daysUntilDue !== undefined && project.daysUntilDue >= 0 && project.daysUntilDue <= 30);
  const overdue = projects.filter((project) => project.daysUntilDue !== null && project.daysUntilDue !== undefined && project.daysUntilDue < 0);
  const registrationCounts = countProjectStatuses(
    projects,
    (project) => complianceStatusBucket(project.registrationStatus),
    ['Not checked', 'Complete', 'Missing'],
  );
  const payrollCounts = countProjectStatuses(projects, (project) => complianceStatusBucket(project.payrollFormsStatus), ['Not checked', 'Complete', 'Missing']);
  const formsCounts = countProjectStatuses(projects, (project) => formsStatusBucket(project.formsStatus), [missingFormsLabel, allFormsLabel, notTrackedFormsLabel]);
  const matchingProjects = projects.filter(p => {
    const text = `${p.projectName} ${p.projectNumber} ${p.projectKey} ${p.contractorName} ${p.dirNumber} ${p.classification} ${p.formsStatus} ${p.form1Status} ${p.form2Status} ${p.form3Status} ${p.form4Status} ${p.pasCipDpw ? 'PAS CIP+DPW' : ''} ${p.complianceNotes}`.toLowerCase();
    const searchMatches = text.includes(query.toLowerCase());
    const dueDate = p.paymentDueDate || '';
    return searchMatches
      && (contractorFilter === 'all' || String(p.contractorId ?? '') === contractorFilter)
      && (registrationFilter === 'all' || complianceStatusBucket(p.registrationStatus).toLowerCase() === registrationFilter)
      && (payrollFilter === 'all' || complianceStatusBucket(p.payrollFormsStatus).toLowerCase() === payrollFilter)
      && (formsFilter === 'all' || (formsFilter === 'missing'
        ? formsStatusBucket(p.formsStatus) === missingFormsLabel
        : formsFilter === 'all-forms'
          ? formsStatusBucket(p.formsStatus) === allFormsLabel
          : formsStatusBucket(p.formsStatus) === notTrackedFormsLabel))
      && (!dueFrom || (dueDate && dueDate >= dueFrom))
      && (!dueTo || (dueDate && dueDate <= dueTo));
  });
  const needsActionProjects: Record<NeedsActionTab, Project[]> = {
    LCP: projects.filter((project) => !project.registrationBypass && isMissingStatus(project.registrationStatus)),
    DIR: projects.filter((project) => !project.payrollFormsBypass && isMissingStatus(project.payrollFormsStatus)),
    Forms: projects.filter((project) => formsStatusBucket(project.formsStatus) === missingFormsLabel),
  };
  const activeNeedsActionSearch = needsActionSearches[needsActionTab].trim().toLowerCase();
  const activeNeedsActionFilter = needsActionFilters[needsActionTab];
  const activeNeedsActionProjects = sortRows(needsActionProjects[needsActionTab].filter((project) => {
    const searchText = [
      project.projectName, project.projectNumber, project.projectKey, project.dirNumber,
      project.contractorName, project.registrationStatus, project.registrationBypassStatus,
      project.payrollFormsStatus, project.payrollFormsBypassStatus,
      project.form1Status, project.form2Status, project.form3Status, project.form4Status,
      project.complianceNotes,
    ].join(' ').toLowerCase();
    if (!searchText.includes(activeNeedsActionSearch)) return false;
    if (needsActionTab === 'Forms') {
      if (activeNeedsActionFilter === 'all') return true;
      const formIndex = Number(activeNeedsActionFilter.replace('form-', '')) - 1;
      const formStatus = [project.form1Status, project.form2Status, project.form3Status, project.form4Status][formIndex];
      return complianceStatusBucket(formStatus) !== 'Complete';
    }
    if (activeNeedsActionFilter === 'all') return true;
    const status = complianceStatusBucket(needsActionTab === 'LCP' ? project.registrationStatus : project.payrollFormsStatus);
    return status.toLowerCase() === activeNeedsActionFilter.replace('-', ' ');
  }), needsActionSort, {
    ...projectSortAccessors,
    status: (project) => needsActionTab === 'LCP'
      ? project.registrationStatus
      : needsActionTab === 'DIR'
        ? project.payrollFormsStatus
        : project.formsStatus,
  });
  const needsActionPageCount = Math.max(1, Math.ceil(activeNeedsActionProjects.length / 10));
  const activeNeedsActionPage = Math.min(needsActionPage, needsActionPageCount - 1);
  const visibleNeedsActionProjects = activeNeedsActionProjects.slice(activeNeedsActionPage * 10, activeNeedsActionPage * 10 + 10);
  const needsActionLabel = (project: Project) => needsActionTab === 'LCP'
    ? needsActionStatusLabel(project.registrationStatus)
    : needsActionTab === 'DIR'
      ? needsActionStatusLabel(project.payrollFormsStatus)
      : formsStatusBucket(project.formsStatus);
  const recentProjects = sortRows(matchingProjects, recentSort, projectSortAccessors).slice(0, 10);
  const exportCsv = () => {
    const columns = ['Project number', 'Project name', 'Contractor', 'Labor compliance status', 'LCP bypass', 'DIR number', 'DIR status', 'DIR bypass', 'Forms status', 'Payment due date', 'Payment date', 'Checked labor compliance', 'Checked DIR'];
    const rows = projects.map((project) => {
      const display = displayProject(project);
      return [display.projectNumber, display.projectName, display.contractorName, complianceStatusBucket(project.registrationStatus), project.registrationBypass ? project.registrationBypassStatus : '', display.dirNumber, complianceStatusBucket(project.payrollFormsStatus), project.payrollFormsBypass ? project.payrollFormsBypassStatus : '', formsStatusBucket(project.formsStatus), project.paymentDueDate, project.paymentDate, project.registrationCheckedOn, project.payrollFormsCheckedOn];
    });
    const csv = [columns, ...rows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); anchor.download = `sunnyvale-weekly-status-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(anchor.href);
  };
  return <><PageHeader eyebrow="Live status · Updated from SQL Server" title="Overview" description="Live counts for labor compliance, DIR, and forms. Source records remain available in SSMS data." action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Link className="btn" href="/contractors"><Building2 /> Contractors</Link><button className="btn" onClick={exportCsv}><Download /> Weekly status CSV</button><button className="btn btn-primary" onClick={() => onAdd('project')}><Plus /> Add project</button></div>} />
     {loading && !workspace ? <div className="panel loading-state"><div className="empty-mark"><Activity /></div>Loading current compliance records…</div> : error && !workspace ? <ErrorBox retry={retry} /> : <>
       {workspace && (error || dataIsStale) && <div className="workspace-stale-notice" role="status">
         <span>Showing the last successfully loaded records{refreshedAt && Number.isFinite(refreshedAt.getTime()) ? ` · refreshed ${refreshedAt.toLocaleString()}` : ''}.</span>
         <button type="button" className="btn" onClick={retry}>Try refresh</button>
       </div>}
      <div className="metric-grid">
         <Metric label="Active projects" value={projects.length} note="In the project register" />
        <Metric label="Due soon / overdue" value={`${soon.length} / ${overdue.length}`} note="Payment due in 30 days / past due" tone="gold" />
        <Metric label="Withholding held" value={summary.unreleasedWithholdings ?? 0} note={`${money(summary.amountWithheld)} unreleased`} tone="alert" />
      </div>
      <div className="status-summary-grid">
        <StatusCountCard title="Labor compliance" counts={registrationCounts} total={projects.length} />
        <StatusCountCard title="DIR status" counts={payrollCounts} total={projects.length} />
        <StatusCountCard title="Forms" counts={formsCounts} total={projects.length} />
      </div>
      <section className="panel needs-action-panel">
        <div className="panel-head">
          <div><h2 className="panel-title">Needs Action</h2><div className="panel-kicker" style={{ marginTop: 5 }}>Missing or unrecorded status fields</div></div>
          <span className="panel-kicker">{activeNeedsActionProjects.length} projects</span>
        </div>
        <div className="needs-action-tabs" role="tablist" aria-label="Needs Action categories">
          {needsActionTabs.map((tab) => <button
            key={tab}
            type="button"
            role="tab"
            id={`needs-action-tab-${tab.toLowerCase()}`}
            aria-selected={needsActionTab === tab}
            tabIndex={needsActionTab === tab ? 0 : -1}
            aria-controls="needs-action-panel-content"
            className={`needs-action-tab ${needsActionTab === tab ? 'active' : ''}`}
            onClick={() => { setNeedsActionTab(tab); setNeedsActionPage(0); }}
            onKeyDown={(event) => {
              const currentIndex = needsActionTabs.indexOf(tab);
              let nextIndex = currentIndex;
              if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % needsActionTabs.length;
              else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + needsActionTabs.length - 1) % needsActionTabs.length;
              else if (event.key === 'Home') nextIndex = 0;
              else if (event.key === 'End') nextIndex = needsActionTabs.length - 1;
              else return;
              event.preventDefault();
              const nextTab = needsActionTabs[nextIndex];
              setNeedsActionTab(nextTab);
              setNeedsActionPage(0);
              window.requestAnimationFrame(() => document.getElementById(`needs-action-tab-${nextTab.toLowerCase()}`)?.focus());
            }}
          ><span>{tab}</span><span className="needs-action-tab-count">{needsActionProjects[tab].length}</span></button>)}
        </div>
        <div id="needs-action-panel-content" role="tabpanel" aria-labelledby={`needs-action-tab-${needsActionTab.toLowerCase()}`}>
          <div className="needs-action-tools">
            <TextFilter
              value={needsActionSearches[needsActionTab]}
              onChange={(value) => { setNeedsActionSearches((current) => ({ ...current, [needsActionTab]: value })); setNeedsActionPage(0); }}
              placeholder={`Search ${needsActionTab} projects…`}
            />
            <label className="needs-action-filter">
              <span>{needsActionTab === 'Forms' ? 'Filter by form' : 'Filter by status'}</span>
              <select
                className="field select-field"
                aria-label={`Filter ${needsActionTab} needs-action projects`}
                value={needsActionFilters[needsActionTab]}
                onChange={(event) => { setNeedsActionFilters((current) => ({ ...current, [needsActionTab]: event.target.value })); setNeedsActionPage(0); }}
              >
                {needsActionTab === 'Forms'
                  ? <><option value="all">All forms</option><option value="form-1">Form 1 needs action</option><option value="form-2">Form 2 needs action</option><option value="form-3">Form 3 needs action</option><option value="form-4">Form 4 needs action</option></>
                  : <><option value="all">All statuses</option><option value="not-checked">Not checked</option><option value="missing">Missing</option></>}
              </select>
            </label>
             <SortByControl
               value={needsActionSort}
               onChange={(value) => { setNeedsActionSort(value); setNeedsActionPage(0); }}
               options={[
                 { value: 'newest:desc', label: 'Newest added' },
                 { value: 'newest:asc', label: 'Oldest added' },
                 { value: 'projectName:asc', label: 'Project name A–Z' },
                 { value: 'contractor:asc', label: 'Contractor A–Z' },
                 { value: 'status:asc', label: 'Status' },
               ]}
             />
          </div>
          {visibleNeedsActionProjects.length ? <div className="needs-action-list">
            {visibleNeedsActionProjects.map((project) => {
              const display = displayProject(project);
              return <div className="needs-action-row" key={`${needsActionTab}-${project.id}`}>
                <div className="needs-action-project">
                  <div className="workflow-name">{display.projectName}</div>
                  <div className="workflow-detail">{display.projectNumber} · {display.contractorName || 'Contractor not assigned'}</div>
                </div>
                <div className="needs-action-row-action">
                  <Status value={needsActionLabel(project)} />
                  <RecordRowActions recordType="project" recordId={project.id} title={display.projectName} onEdit={() => onEdit('project', project)} onDelete={onDelete} />
                </div>
              </div>;
            })}
          </div> : <Empty
            title={needsActionProjects[needsActionTab].length ? `No matching ${needsActionTab} projects` : `No ${needsActionTab} projects need action`}
            detail={needsActionProjects[needsActionTab].length ? 'Try changing the search or filter.' : 'No matching projects have missing or unrecorded fields.'}
          />}
        </div>
        {activeNeedsActionProjects.length > 10 && <div className="needs-action-pagination">
          <span>Showing {activeNeedsActionPage * 10 + 1}–{Math.min((activeNeedsActionPage + 1) * 10, activeNeedsActionProjects.length)} of {activeNeedsActionProjects.length}</span>
          <div className="needs-action-page-controls">
            <button type="button" className="btn" disabled={activeNeedsActionPage === 0} onClick={() => setNeedsActionPage(activeNeedsActionPage - 1)}>Previous</button>
            <span>Page {activeNeedsActionPage + 1} of {needsActionPageCount}</span>
            <button type="button" className="btn" disabled={activeNeedsActionPage >= needsActionPageCount - 1} onClick={() => setNeedsActionPage(activeNeedsActionPage + 1)}>Next</button>
          </div>
        </div>}
      </section>
       <section style={{ marginTop: 22 }}>
          <div className="panel-head" style={{ padding: '0 0 13px', border: 0 }}><div><div className="eyebrow">Up to 10 matching projects</div><h2 className="panel-title">Most recent projects</h2></div><span className="refresh-label">Showing {recentProjects.length} of {matchingProjects.length} matching projects</span></div>
        <div className="tools-row" style={{ alignItems: 'center' }}>
          <TextFilter value={query} onChange={setQuery} placeholder="Search project, number, contractor…" />
          <SortByControl value={recentSort} onChange={setRecentSort} options={projectSortOptions} />
          <select className="field select-field" value={contractorFilter} onChange={e => setContractorFilter(e.target.value)} aria-label="Contractor filter"><option value="all">All contractors</option>{alphabetizedContractors(contractors).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="field select-field" value={registrationFilter} onChange={e => setRegistrationFilter(e.target.value)} aria-label="Labor compliance status filter"><option value="all">Any Labor compliance status</option><option value="not checked">Not checked</option><option value="complete">Complete</option><option value="missing">Missing</option></select>
          <select className="field select-field" value={payrollFilter} onChange={e => setPayrollFilter(e.target.value)} aria-label="DIR status filter"><option value="all">Any DIR status</option><option value="not checked">Not checked</option><option value="complete">Complete</option><option value="missing">Missing</option></select>
          <select className="field select-field" value={formsFilter} onChange={e => setFormsFilter(e.target.value)} aria-label="Forms status filter"><option value="all">Any Forms status</option><option value="missing">Projects with missing forms</option><option value="all-forms">Projects with all forms</option><option value="not-tracked">Forms not tracked</option></select>
          <label className="date-filter"><span>Payment due from</span><input className="field" type="date" value={dueFrom} onChange={e => setDueFrom(e.target.value)} aria-label="Payment due from date" /></label>
          <label className="date-filter"><span>Payment due to</span><input className="field" type="date" value={dueTo} onChange={e => setDueTo(e.target.value)} aria-label="Payment due to date" /></label>
        </div>
          <TableScrollRegion><section className="panel table-wrap">{!recentProjects.length ? <Empty title="No projects match these filters" detail="Clear or adjust your search and field filters to see more records." /> : <RowNumberedTable className="data-table"><thead><tr><th>Project</th><th>Contractor</th><th>Labor compliance</th><th>DIR #</th><th>DIR status</th><th>Forms</th><th>Payment due</th><th>Comments</th><th>Actions</th></tr></thead><tbody>{recentProjects.map((p) => {
            const display = displayProject(p);
            return <tr key={p.id} data-testid={`row-dashboard-project-${p.id}`}>
              <td><div className="table-primary">{display.projectName}</div><div className="table-secondary">{display.projectNumber}</div></td><td>{display.contractorName || '—'}</td><td><ComplianceStatusWithBypass value={complianceStatusBucket(p.registrationStatus)} bypass={p.registrationBypass} bypassStatus={p.registrationBypassStatus} /><div className="table-secondary">Checked {dateLabel(p.registrationCheckedOn)}</div></td><td>{display.dirNumber || '—'}</td><td><ComplianceStatusWithBypass value={complianceStatusBucket(p.payrollFormsStatus)} bypass={p.payrollFormsBypass} bypassStatus={p.payrollFormsBypassStatus} /><div className="table-secondary">Checked {dateLabel(p.payrollFormsCheckedOn)}</div></td><td><Status value={formsStatusBucket(p.formsStatus)} /></td><td>{dateLabel(p.paymentDueDate)}</td><td><CommentsPreview projectId={p.id} projectName={display.projectName} comments={p.complianceNotes} /></td><td className="record-actions-cell" data-label="Actions"><RecordRowActions recordType="project" recordId={p.id} title={display.projectName} onEdit={() => onEdit('project', p)} onDelete={onDelete} /></td>
            </tr>;
          })}</tbody></RowNumberedTable>}</section></TableScrollRegion>
      </section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 15 }}><span className="refresh-label">Refreshes every minute · Last refreshed {summary.refreshedAt ? dateLabel(summary.refreshedAt) : 'just now'}</span></div>
    </>}
  </>;
}

function TextFilter({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <div className="search-box"><Search /><input className="field" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}

const projectSortOptions: SortOption[] = [
  { value: 'projectName:asc', label: 'Project name A–Z' },
  { value: 'projectName:desc', label: 'Project name Z–A' },
  { value: 'projectNumber:asc', label: 'Project number' },
  { value: 'contractor:asc', label: 'Contractor A–Z' },
  { value: 'newest:desc', label: 'Newest added' },
  { value: 'newest:asc', label: 'Oldest added' },
  { value: 'paymentDue:asc', label: 'Payment due date' },
];
const projectSortAccessors = {
  projectName: (project: Project) => project.projectName,
  projectNumber: (project: Project) => project.projectNumber || project.projectKey,
  contractor: (project: Project) => project.contractorName,
  newest: (project: Project) => project.id,
  paymentDue: (project: Project) => project.paymentDueDate,
};

type DesignRowValues = {
  dirNumber: string;
  projectNumber: string;
  projectName: string;
  contractorId: string;
  registrationStatus: string;
  registrationBypass: boolean;
  registrationBypassStatus: '' | 'OK' | 'Completed';
  payrollFormsStatus: string;
  payrollFormsBypass: boolean;
  payrollFormsBypassStatus: '' | 'OK' | 'Completed';
  pwc100: boolean;
  pwc100RegisteredDate: string;
};
function getDesignRowValues(project: Project): DesignRowValues {
  return {
    dirNumber: project.dirNumber || '',
    projectNumber: project.projectNumber || '',
    projectName: project.projectName || '',
    contractorId: project.contractorId ? String(project.contractorId) : '',
    registrationStatus: complianceStatusBucket(project.registrationStatus),
    registrationBypass: project.registrationBypass,
    registrationBypassStatus: project.registrationBypassStatus,
    payrollFormsStatus: complianceStatusBucket(project.payrollFormsStatus),
    payrollFormsBypass: project.payrollFormsBypass,
    payrollFormsBypassStatus: project.payrollFormsBypassStatus,
    pwc100: project.pwc100,
    pwc100RegisteredDate: project.pwc100RegisteredDate || '',
  };
}
function DesignProjectRow({ project, contractors, onSave, onEdit, onDelete }: { project: Project; contractors: Contractor[]; onSave: (id: number, values: ProjectUpdate) => Promise<void>; onEdit: () => void; onDelete: (recordType: TrashRecordType, id: number, title: string) => void }) {
  const [values, setValues] = useState(() => getDesignRowValues(project));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dirNumberTouched, setDirNumberTouched] = useState(false);
  useEffect(() => setValues(getDesignRowValues(project)), [project]);
  const setField = <K extends keyof DesignRowValues>(key: K, value: DesignRowValues[K]) => setValues(current => ({ ...current, [key]: value }));
  const fieldProps = (key: keyof DesignRowValues, label: string) => ({
    'aria-label': `${label} for ${project.projectName || 'project'}`,
    value: values[key] as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setField(key, event.target.value as never),
  });
  const save = async () => {
    setSaving(true);
    setSaveError('');
    if (!values.projectName.trim()) {
      setSaveError('Project name is required to save.');
      setSaving(false);
      return;
    }
    if (dirNumberTouched && !isValidDirNumber(values.dirNumber.trim())) {
      setSaveError('DIR number must contain 6 or 11 digits.');
      setSaving(false);
      return;
    }
    if (values.registrationBypass && !values.registrationBypassStatus) {
      setSaveError('Choose OK or Completed for the LCP bypass.');
      setSaving(false);
      return;
    }
    if (values.payrollFormsBypass && !values.payrollFormsBypassStatus) {
      setSaveError('Choose OK or Completed for the DIR bypass.');
      setSaving(false);
      return;
    }
    try {
      const update: ProjectUpdate = {
        dirNumber: values.dirNumber,
        projectNumber: values.projectNumber,
        projectName: values.projectName,
        contractorId: values.contractorId ? Number(values.contractorId) : null,
        registrationStatus: values.registrationStatus === 'Complete' ? 'Registered' : values.registrationStatus,
        registrationBypass: values.registrationBypass,
        registrationBypassStatus: values.registrationBypassStatus,
        payrollFormsStatus: values.payrollFormsStatus === 'Complete' ? 'Complete' : values.payrollFormsStatus,
        payrollFormsBypass: values.payrollFormsBypass,
        payrollFormsBypassStatus: values.payrollFormsBypassStatus,
        pwc100: values.pwc100,
        pwc100RegisteredDate: values.pwc100 ? values.pwc100RegisteredDate || null : null,
      };
      if (!dirNumberTouched) delete update.dirNumber;
      await onSave(project.id, update);
    } catch {
      setSaveError('Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return <tr data-testid={`row-design-project-${project.id}`}>
    <td><div className="design-number-cell">
      <input className="field design-cell-input" {...fieldProps('projectNumber', 'Project number')} />
      <span className="table-secondary">Prime approver: {project.designProjectManager || 'Not recorded'}</span>
    </div></td>
    <td><div className="design-required-name">
      <input className="field design-cell-input" aria-required="true" title="Project name is required to save" {...fieldProps('projectName', 'Project name')} />
      <span className="required-mark" aria-hidden="true">*</span>
    </div></td>
    <td><select className="field design-cell-input" aria-label={`Primary contractor for ${project.projectName}`} value={values.contractorId} onChange={event => setField('contractorId', event.target.value)}><option value="">Select contractor…</option>{alphabetizedContractors(contractors).map(contractor => <option key={contractor.id} value={contractor.id}>{contractor.name}</option>)}</select></td>
    <td><div>{project.projectInitiationDate ? `Start: ${dateLabel(project.projectInitiationDate)}` : 'Start not recorded'}</div><div className="table-secondary">{project.projectFinishDate ? `End: ${dateLabel(project.projectFinishDate)}` : 'End not recorded'}</div></td>
    <td><select className="field design-cell-input" aria-label={`Labor compliance for ${project.projectName}`} value={values.registrationStatus} onChange={event => setField('registrationStatus', event.target.value)}><option>Not checked</option><option>Complete</option><option>Missing</option></select><div className="inline-bypass-control"><label><input type="checkbox" aria-label={`LCP bypass for ${project.projectName}`} checked={values.registrationBypass} onChange={event => { setField('registrationBypass', event.target.checked); if (!event.target.checked) setField('registrationBypassStatus', ''); }} />Bypass</label>{values.registrationBypass && <select className="field design-cell-input" aria-label={`LCP bypass status for ${project.projectName}`} required value={values.registrationBypassStatus} onChange={event => setField('registrationBypassStatus', event.target.value as DesignRowValues['registrationBypassStatus'])}><option value="">Select…</option><option>OK</option><option>Completed</option></select>}</div></td>
    <td><input className="field design-cell-input" inputMode="numeric" maxLength={11} pattern={DIR_NUMBER_PATTERN} title="Enter 6 or 11 digits" {...fieldProps('dirNumber', 'DIR number')} onChange={event => { setDirNumberTouched(true); setField('dirNumber', event.target.value.replace(/\D/g, '').slice(0, 11)); }} /></td>
    <td><select className="field design-cell-input" aria-label={`DIR compliance for ${project.projectName}`} value={values.payrollFormsStatus} onChange={event => setField('payrollFormsStatus', event.target.value)}><option>Not checked</option><option>Complete</option><option>Missing</option></select><div className="inline-bypass-control"><label><input type="checkbox" aria-label={`DIR bypass for ${project.projectName}`} checked={values.payrollFormsBypass} onChange={event => { setField('payrollFormsBypass', event.target.checked); if (!event.target.checked) setField('payrollFormsBypassStatus', ''); }} />Bypass</label>{values.payrollFormsBypass && <select className="field design-cell-input" aria-label={`DIR bypass status for ${project.projectName}`} required value={values.payrollFormsBypassStatus} onChange={event => setField('payrollFormsBypassStatus', event.target.value as DesignRowValues['payrollFormsBypassStatus'])}><option value="">Select…</option><option>OK</option><option>Completed</option></select>}</div></td>
    <td><div className="design-pwc-cell">
      <label className="checkbox-control design-pwc-toggle"><input type="checkbox" aria-label={`PWC-100 Yes for ${project.projectName}`} checked={values.pwc100} onChange={event => { setField('pwc100', event.target.checked); if (!event.target.checked) setField('pwc100RegisteredDate', ''); }} /><span>Yes</span></label>
      {values.pwc100 && <input className="field design-cell-input" type="date" aria-label={`PWC-100 date for ${project.projectName}`} value={values.pwc100RegisteredDate} onChange={event => setField('pwc100RegisteredDate', event.target.value)} />}
      {!values.pwc100 && <span className="table-secondary">No</span>}
    </div></td>
    <td>{project.designPwcrExpirationDate ? dateLabel(project.designPwcrExpirationDate) : 'Not recorded'}</td>
    <td><CommentsPreview projectId={project.id} projectName={project.projectName} comments={project.complianceNotes} /></td>
    <td className="design-save-cell record-actions-cell" data-label="Actions"><RecordRowActions recordType="project" recordId={project.id} title={project.projectName} onEdit={onEdit} onDelete={onDelete} /><button type="button" className="btn btn-primary design-save-button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>{saveError && <span className="design-save-error" role="alert">{saveError}</span>}</td>
  </tr>;
}
function DesignProjectsPage({ projects, contractors, loading, error, retry, onSave, onAdd, onEdit, onDelete }: { projects: Project[]; contractors: Contractor[]; loading: boolean; error: boolean; retry: () => void; onSave: (id: number, values: ProjectUpdate) => Promise<void>; onAdd: (kind: Kind, initial?: Record<string, unknown>) => void; onEdit: (kind: Kind, record: Project) => void; onDelete: (recordType: TrashRecordType, id: number, title: string) => void }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('projectName:asc');
  const designProjects = projects.filter(project => !isUnnamedProject(project) && (project.designProject || projectComesFromSheet(project, '2. LCP & DIR - DESIGN')));
  const filtered = sortRows(designProjects.filter(project => `${project.dirNumber} ${project.projectNumber} ${project.designProjectManager} ${project.designProjectManagerEmail} ${project.designWeekStart} ${project.designWeekEnd} ${project.designPwcrExpirationDate} ${project.projectName} ${project.contractorName} ${project.registrationStatus} ${project.payrollFormsStatus} ${project.form1Status} ${project.form2Status} ${project.form3Status} ${project.form4Status} ${project.complianceNotes}`.toLowerCase().includes(search.toLowerCase())), sortBy, projectSortAccessors);
  return <>
    <PageHeader eyebrow="Project register · SQL Server records" title="DESIGN" description="Review imported Design records and edit fields supported by the SQL Server application tables." action={<button className="btn btn-primary" onClick={() => onAdd('project', { designProject: true })}><Plus /> Add project</button>} />
    <div className="tools-row"><TextFilter value={search} onChange={setSearch} placeholder="Search Design project fields…" /><SortByControl value={sortBy} onChange={setSortBy} options={projectSortOptions} /><span className="refresh-label">{filtered.length} projects</span></div>
    <TableScrollRegion><section className="panel table-wrap pas-cip-dpw-wrap design-table-wrap">
      {error ? <ErrorBox retry={retry} /> : loading ? <div className="loading-state">Loading Design project records…</div> : !filtered.length ? <Empty title="No Design project records" detail="Projects from the DESIGN worksheet will appear here." /> :
        <RowNumberedTable className="data-table pas-cip-dpw-table design-project-table" aria-label="Design project entry fields">
          <colgroup><col style={{ width: '8%' }} /><col style={{ width: '12%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '10%' }} /><col style={{ width: '6%' }} /></colgroup>
          <thead>
            <tr><th>Proj #</th><th>Proj Name</th><th>Primary Contractor</th><th>Project started?</th><th>LCP</th><th>DIR #</th><th>DIR</th><th>PWC-100 date</th><th>PWCR exp (once a year or every 3 years)</th><th>Comments</th><th>Actions</th></tr>
          </thead>
          <tbody>{filtered.map(project => <DesignProjectRow key={project.id} project={project} contractors={contractors} onSave={onSave} onEdit={() => onEdit('project', project)} onDelete={onDelete} />)}</tbody>
        </RowNumberedTable>}
    </section></TableScrollRegion>
  </>;
}
function PasCipDpwPage({ projects, loading, error, retry, onAdd, onEdit, onDelete }: { projects: Project[]; loading: boolean; error: boolean; retry: () => void; onAdd: (kind: Kind, initial?: Record<string, unknown>) => void; onEdit: (kind: Kind, record: Project) => void; onDelete: (recordType: TrashRecordType, id: number, title: string) => void }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('projectName:asc');
  const sheetProjects = projects.filter((project) =>
    !isUnnamedProject(project) &&
    project.pasCipDpw,
  );
  const filtered = sortRows(sheetProjects.filter((project) => {
    const searchable = [
      project.projectNumber, project.projectName, project.contractorName,
      project.projectInitiationDate, project.projectFinishDate,
      project.registrationStatus, project.payrollFormsStatus,
      project.form1Status, project.form2Status, project.form3Status, project.form4Status,
      project.formsStatus, project.pwc100 ? 'Yes' : 'No',
      project.pwc100RegisteredDate, project.pwc100ExpirationDate, project.complianceNotes,
    ].join(' ').toLowerCase();
    return searchable.includes(search.toLowerCase());
  }), sortBy, projectSortAccessors);
  return <>
    <PageHeader eyebrow="Project register · SQL Server data" title="PAS CIP+DPW" description="PAS CIP+DPW records from the SQL Server project register. Add or edit a project to update its shared record." action={<button className="btn btn-primary" onClick={() => onAdd('project', { pasCipDpw: true })}><Plus /> Add project</button>} />
    <div className="tools-row"><TextFilter value={search} onChange={setSearch} placeholder="Search project, status, form, date, or comment…" /><SortByControl value={sortBy} onChange={setSortBy} options={projectSortOptions} /><span className="refresh-label">{filtered.length} projects</span></div>
    <TableScrollRegion><section className="panel table-wrap pas-cip-dpw-wrap">
      {error ? <ErrorBox retry={retry} /> : loading ? <div className="loading-state">Loading PAS CIP+DPW projects…</div> : !filtered.length ? <Empty title="No matching PAS CIP+DPW projects" detail="Adjust your search, or add a project to the shared register." /> :
        <RowNumberedTable className="data-table pas-cip-dpw-table" aria-label="PAS CIP+DPW project details">
          <colgroup><col style={{ width: '7%' }} /><col style={{ width: '9%' }} /><col style={{ width: '12%' }} /><col style={{ width: '10%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} /><col style={{ width: '7%' }} /><col style={{ width: '13%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '13%' }} /><col style={{ width: '2%' }} /></colgroup>
          <thead>
            <tr><th>Project Num</th><th>Project Name</th><th>Contractor</th><th>Project started?</th><th>Labor compliance</th><th>DIR #</th><th>DIR Status</th><th>Forms</th><th>PWC-100 date</th><th>PWCR exp (once a year or every 3 years)</th><th>Comments</th><th>Actions</th></tr>
          </thead>
          <tbody>{filtered.map((project) => <tr key={project.id} data-testid={`row-pas-project-${project.id}`}>
            <td>{project.projectNumber}</td>
            <td className="table-primary">{project.projectName}</td>
            <td>{project.contractorName}</td>
            <td><div>Start: {project.projectInitiationDate ? dateLabel(project.projectInitiationDate) : ''}</div><div>End: {project.projectFinishDate ? dateLabel(project.projectFinishDate) : ''}</div></td>
            <td className="status-cell"><ComplianceStatusWithBypass value={projectEntryStatusLabel(project.registrationStatus) || 'Not checked'} bypass={project.registrationBypass} bypassStatus={project.registrationBypassStatus} />{project.registrationCheckedOn && <div className="table-secondary">Date: {dateLabel(project.registrationCheckedOn)}</div>}</td>
            <td>{project.dirNumber || '—'}</td>
            <td className="status-cell"><ComplianceStatusWithBypass value={projectEntryStatusLabel(project.payrollFormsStatus) || 'Not checked'} bypass={project.payrollFormsBypass} bypassStatus={project.payrollFormsBypassStatus} />{project.payrollFormsCheckedOn && <div className="table-secondary">Date: {dateLabel(project.payrollFormsCheckedOn)}</div>}</td>
            <td className="pas-form-statuses">{[project.form1Status, project.form2Status, project.form3Status, project.form4Status].map((formStatus, index) => <div key={index}><span>Form {index + 1}:</span> {formStatus || 'Not checked'}</div>)}</td>
            <td>{project.pwc100 ? project.pwc100RegisteredDate ? dateLabel(project.pwc100RegisteredDate) : '' : '—'}</td>
            <td>{project.pwc100ExpirationDate ? dateLabel(project.pwc100ExpirationDate) : ''}</td>
            <td><CommentsPreview projectId={project.id} projectName={project.projectName} comments={project.complianceNotes} /></td>
            <td className="record-actions-cell" data-label="Actions"><RecordRowActions recordType="project" recordId={project.id} title={project.projectName} onEdit={() => onEdit('project', project)} onDelete={onDelete} /></td>
          </tr>)}</tbody>
        </RowNumberedTable>}
    </section></TableScrollRegion>
  </>;
}

const activeFederalColumns: { key: string; label: string; className?: string }[] = [
  { key: 'A', label: 'Federal Projects as of 1/10/2024', className: 'table-primary' },
  { key: 'B', label: 'Project #' },
  { key: 'C', label: 'DIR #' },
  { key: 'D', label: 'Contractor' },
  { key: 'E', label: 'Federal Project No.' },
  { key: 'F', label: 'Davis-Bacon General Determination (Mod # & effective Date)' },
  { key: 'G', label: 'Project set-up as Federal in LCP?' },
  { key: 'H', label: 'Notes' },
  { key: 'I', label: 'Active' },
];

function ActiveFederalProjectsTable({ rows, identityRows, contractors, onEdit, onCreateFromSource, openDatabaseEditor, onDelete }: {
  rows: ActiveFederalTableRow<Project>[];
  identityRows: ActiveFederalTableRow<Project>[];
  contractors: Contractor[];
  onEdit: (kind: Kind, record: Project) => void;
  onCreateFromSource: (initial: Record<string, unknown>) => void;
  openDatabaseEditor: (request: DatabaseEditRequest) => void;
  onDelete: (recordType: TrashRecordType, id: number, title: string) => void;
}) {
  const sourceValue = (row: ActiveFederalTableRow<Project>, column: string) => {
    const cell = row.source?.cells[`${column}${row.source.excelRow}`];
    return cell?.value ?? (cell?.formula ? `=${cell.formula}` : '');
  };
  const sourceTextValue = (row: ActiveFederalTableRow<Project>, column: string) => {
    const cell = row.source?.cells[`${column}${row.source.excelRow}`];
    return cell?.value === null || cell?.value === undefined ? '' : String(cell.value).trim();
  };
  const projectValue = (row: ActiveFederalTableRow<Project>, excelColumn: string, value: string | null | undefined) =>
    value || sourceValue(row, excelColumn) || '—';
  const normalizeValue = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const findContractorId = (contractorName: string) => {
    const normalizedName = normalizeValue(contractorName);
    if (!normalizedName) return '';
    const matches = contractors.filter((contractor) => {
      const aliases = String((contractor as Contractor & { aliases?: string }).aliases ?? '')
        .split(/[,;|]/)
        .map(normalizeValue);
      return normalizeValue(contractor.name) === normalizedName || aliases.includes(normalizedName);
    });
    return matches.length === 1 ? matches[0].id : '';
  };
  const editRow = (row: ActiveFederalTableRow<Project>) => {
    if (row.project) {
      onEdit('project', {
        ...row.project,
        projectName: row.project.projectName || sourceValue(row, 'A'),
        projectNumber: row.project.projectNumber || sourceValue(row, 'B'),
        dirNumber: row.project.dirNumber || sourceValue(row, 'C'),
        federalProjectNumber: row.project.federalProjectNumber ?? sourceValue(row, 'E'),
        davisBaconDetermination: row.project.davisBaconDetermination ?? sourceValue(row, 'F'),
        federalSetupInLcp: row.project.federalSetupInLcp ?? sourceValue(row, 'G'),
        federalNotes: row.project.federalNotes ?? sourceValue(row, 'H'),
        federalActive: row.project.federalActive ?? sourceValue(row, 'I'),
      });
      return;
    }
    if (row.source) {
      const projectName = sourceTextValue(row, 'A');
      const sourceIdentityConflict = hasConflictingActiveFederalSourceIdentity(
        identityRows.flatMap((candidate) => candidate.source ? [candidate.source] : []),
        row.source,
      );
      if (row.matchState === 'ambiguous' || sourceIdentityConflict || !normalizeValue(projectName)) {
        openDatabaseEditor({
          schemaName: 'labor_compliance_excel_stage',
          tableName: 'SourceRows',
          key: { Id: row.source.id },
          initialRow: { Id: row.source.id, ExcelRow: row.source.excelRow, CellsJson: JSON.stringify(row.source.cells, null, 2) },
          editor: 'activeFederalSource',
          notice: row.matchState === 'ambiguous'
            ? 'Multiple SQL projects could match this worksheet row. Resolve the project number or name before creating a linked project, to avoid a duplicate.'
            : sourceIdentityConflict
              ? 'Another worksheet row shares a project identifier but has conflicting details. Review the source rows before creating a linked project.'
              : 'This worksheet row has no project name, so it cannot yet be opened as a project record.',
        });
        return;
      }
      const contractorName = sourceTextValue(row, 'D');
      onCreateFromSource({
        projectName,
        projectNumber: sourceTextValue(row, 'B'),
        dirNumber: sourceTextValue(row, 'C'),
        contractorId: findContractorId(contractorName),
        federalProject: true,
        designProject: false,
        onCall: false,
        pasCipDpw: false,
        federalProjectNumber: sourceTextValue(row, 'E'),
        davisBaconDetermination: sourceTextValue(row, 'F'),
        federalSetupInLcp: sourceTextValue(row, 'G'),
        federalNotes: sourceTextValue(row, 'H'),
        federalActive: sourceTextValue(row, 'I'),
      });
      return;
    }
    if (row.project) onEdit('project', row.project);
  };
  return <RowNumberedTable className="data-table active-federal-project-table" aria-label="Federal projects with source data" data-testid="active-federal-combined-table">
    <colgroup>
      <col style={{ width: '24%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} />
      <col style={{ width: '18%' }} /><col style={{ width: '22%' }} /><col style={{ width: '8%' }} />
    </colgroup>
    <thead><tr>
      <th>Project Name</th><th>Proj #</th><th>DIR#</th><th>Federal Proj #</th><th>Notes</th><th>Actions</th>
    </tr></thead>
    <tbody>{rows.map((row) => {
      const project = row.project;
      const display = getActiveFederalProjectDisplay(row);
      const projectName = display.projectName || '—';
      return <tr key={row.key} data-testid={`row-active-federal-combined-${row.key}`}>
        <td data-label="Project Name" className="table-primary">{projectName}</td>
        <td data-label="Proj #">{display.projectNumber || '—'}</td>
        <td data-label="DIR#">{display.dirNumber || '—'}</td>
        <td data-label="Federal Proj #">{(project?.federalProjectNumber ?? sourceValue(row, 'E')) || '—'}</td>
        <td data-label="Notes">
          {(project?.federalNotes ?? sourceValue(row, 'H')) || '—'}
        </td>
        <td className="record-actions-cell" data-label="Actions">{(project || row.source) && <RecordRowActions
          recordType={project ? 'project' : 'sourceRow'}
          recordId={project?.id ?? row.source!.id}
          title={project ? projectName : `Active Federal Projects row ${row.source!.excelRow}`}
          onEdit={() => editRow(row)}
          onDelete={onDelete}
        />}</td>
      </tr>;
    })}</tbody>
  </RowNumberedTable>;
}

function ProjectsPage({ projects, contractors, loading, error, retry, onAdd, onEdit, onCreateFromSource, onDelete, sourceSheet, allProjectsPage = false }: any) {
  const [search, setSearch] = useState('');
  const [activityFilter, setActivityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('projectName:asc');
  const isPasCipDpw = sourceSheet === PAS_CIP_DPW_SOURCE_LABEL;
  const isActiveFederalPage = sourceSheet === 'Active Federal Projects';
  const isOnCallPage = sourceSheet === '3. LCP & DIR - ON CALL NON PAS';
  const openDatabaseEditor = useOpenDatabaseEditor();
  const activeFederalQuery = useGetWorkbookSheetRows('Active Federal Projects', {
    query: {
      enabled: isActiveFederalPage,
      queryKey: getGetWorkbookSheetRowsQueryKey('Active Federal Projects'),
      refetchInterval: 60_000,
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  const isDesignPage = sourceSheet === '2. LCP & DIR - DESIGN';
  const isAllProjectsPage = allProjectsPage;
  const isProjectSectionPage = isAllProjectsPage || isActiveFederalPage || lcpDirWorkbookTabs.some((tab) => tab.label === sourceSheet);
  const sheetProjects = projects.filter((project: Project) => {
    if (isUnnamedProject(project)) return false;
    if (isPasCipDpw) return project.pasCipDpw;
    return !sourceSheet || projectComesFromSheet(project, sourceSheet)
      || projectMatchesTypePage(project, sourceSheet)
      || (isActiveFederalPage && isFederalProjectName(project.projectName));
  });
  const federalSourceRows = parseActiveFederalSourceRows(activeFederalQuery.data ?? []);
  const readFederalCell = (source: (typeof federalSourceRows)[number] | null, column: string) => {
    if (!source) return '';
    const cell = source.cells[`${column}${source.excelRow}`];
    return cell?.value ?? (cell?.formula ? `=${cell.formula}` : '');
  };
  const federalCandidates: Project[] = projects.filter((project: Project) => !isUnnamedProject(project));
  const activeFederalRows = joinActiveFederalRows(federalSourceRows, federalCandidates, sheetProjects);
  const activeFederalFiltered = activeFederalRows.filter((row) => {
    const project = row.project;
    const activity = (project?.federalActive ?? readFederalCell(row.source, 'I')).trim().toLowerCase();
    const isActive = ['yes', 'active', 'true', '1'].includes(activity);
    const isInactive = ['no', 'inactive', 'false', '0'].includes(activity);
    if (activityFilter === 'active' && !isActive) return false;
    if (activityFilter === 'inactive' && !isInactive) return false;
    const searchable = [
      ...(row.source ? activeFederalColumns.map((column) => readFederalCell(row.source, column.key)) : []),
      project?.projectName, project?.projectNumber, project?.projectKey, project?.dirNumber,
      project?.contractorName, project?.federalProjectNumber, project?.davisBaconDetermination,
      project?.federalSetupInLcp, project?.federalNotes, project?.federalActive,
    ].join(' ');
    return searchable.toLowerCase().includes(search.toLowerCase());
  });
  const activeFederalSortOptions: SortOption[] = [
    { value: 'projectName:asc', label: 'Project name A–Z' },
    { value: 'projectName:desc', label: 'Project name Z–A' },
    { value: 'projectNumber:asc', label: 'Project number' },
    { value: 'dirNumber:asc', label: 'DIR number' },
    { value: 'contractor:asc', label: 'Contractor A–Z' },
    { value: 'federalNumber:asc', label: 'Federal project number' },
  ];
  const activeFederalSorted = sortRows(activeFederalFiltered, sortBy, {
    projectName: (row: ActiveFederalTableRow<Project>) => getActiveFederalProjectDisplay(row).projectName,
    projectNumber: (row: ActiveFederalTableRow<Project>) => getActiveFederalProjectDisplay(row).projectNumber,
    dirNumber: (row: ActiveFederalTableRow<Project>) => getActiveFederalProjectDisplay(row).dirNumber,
    contractor: (row: ActiveFederalTableRow<Project>) => getActiveFederalProjectDisplay(row).contractorName || readFederalCell(row.source, 'D'),
    federalNumber: (row: ActiveFederalTableRow<Project>) => row.project?.federalProjectNumber ?? readFederalCell(row.source, 'E'),
  });
  const filtered = sortRows(sheetProjects.filter((p: Project) => {
    const searchable = [
      p.projectName, p.projectNumber, p.projectKey, p.dirNumber, p.contractorName, p.classification, p.primeApprover,
      p.registrationStatus, p.registrationCheckedOn, p.payrollFormsStatus, p.payrollFormsCheckedOn,
      p.formsStatus, p.form1Status, p.form2Status, p.form3Status, p.form4Status,
      p.projectInitiationDate, p.projectFinishDate, p.pwc100 ? 'Yes' : 'No',
      p.pwc100RegisteredDate, p.pwc100ExpirationDate, p.designProjectManager, p.designProjectManagerEmail,
      p.designWeekStart, p.designWeekEnd, p.designPwcrExpirationDate, p.paymentDueDate, p.paymentDate,
      p.federalProject ? 'Federal project' : '', p.designProject ? 'Design project' : '',
      p.onCall ? 'On call' : '', p.pasCipDpw ? 'PAS CIP+DPW' : '', p.complianceNotes,
    ].join(' ');
    return searchable.toLowerCase().includes(search.toLowerCase());
  }), sortBy, projectSortAccessors);
  const pageTitle = isAllProjectsPage ? 'All Projects' : isPasCipDpw ? 'PAS CIP+DPW' : isDesignPage ? 'DESIGN' : sourceSheet || 'Projects';
  const pageDescription = isAllProjectsPage ? 'All named project records with every field from the project entry form.'
    : isPasCipDpw ? 'Project register using imported PAS CIP+DPW records and project-entry form submissions.'
    : isActiveFederalPage ? 'Federal project register using the fields and order from the source worksheet.'
    : isDesignPage ? 'DESIGN projects using the standard project-entry layout.'
    : isOnCallPage ? 'ON CALL / NON PAS projects with prime approver, compliance status, PWC-100, and follow-up details.'
    : sourceSheet ? 'Projects whose imported source records include this Excel sheet.' : 'Track labor compliance, DIR, forms and payment checks without losing the source record.';
  const projectTypeDefaults = sourceSheet === PAS_CIP_DPW_SOURCE_LABEL ? { pasCipDpw: true }
    : sourceSheet === '2. LCP & DIR - DESIGN' ? { designProject: true }
    : sourceSheet === '3. LCP & DIR - ON CALL NON PAS' ? { onCall: true }
      : sourceSheet === 'Active Federal Projects' ? { federalProject: true }
        : undefined;
  const action = isPasCipDpw || projectTypeDefaults || !sourceSheet
    ? <button className="btn btn-primary" onClick={() => onAdd('project', projectTypeDefaults)}><Plus /> Add project</button>
    : undefined;
  const emptyDetail = sourceSheet ? 'No named project records are mapped to this sheet.' : 'Adjust your search or add a project to the register.';
  return <><PageHeader eyebrow={isAllProjectsPage ? 'All project records · Project entry fields' : isPasCipDpw ? 'Project register · Live entry data' : isActiveFederalPage || isDesignPage ? 'Project type · Project-entry fields' : sourceSheet ? 'Excel source sheet · SQL Server project records' : 'Project records · Compliance register'} title={pageTitle} description={pageDescription} action={action} />
    <div className="tools-row">
      <TextFilter value={search} onChange={setSearch} placeholder={isActiveFederalPage ? 'Search Excel and project fields…' : isProjectSectionPage ? 'Search any project entry field…' : 'Search project, number, contractor…'} />
      {isActiveFederalPage && <select className="field select-field" aria-label="Filter by Active status" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
        <option value="all">All federal projects</option><option value="active">Active only</option><option value="inactive">Inactive only</option>
      </select>}
      <SortByControl value={sortBy} onChange={setSortBy} options={isActiveFederalPage ? activeFederalSortOptions : projectSortOptions} />
      <span className="refresh-label">{isActiveFederalPage ? `${activeFederalFiltered.length} projects · ${federalSourceRows.length} Excel rows` : `${filtered.length} records`}</span>
    </div>
    <TableScrollRegion><section className="panel table-wrap">{error ? <ErrorBox retry={retry} /> : loading ? <div className="loading-state">Loading project records…</div> : isActiveFederalPage ? <>
      {activeFederalQuery.isError && <ErrorBox retry={() => void activeFederalQuery.refetch()} />}
      {activeFederalQuery.isLoading && !federalSourceRows.length && <div className="federal-source-loading" role="status">Loading Excel worksheet rows…</div>}
      {activeFederalSorted.length
        ? <ActiveFederalProjectsTable rows={activeFederalSorted} identityRows={activeFederalRows} contractors={contractors} onEdit={onEdit} onCreateFromSource={onCreateFromSource} openDatabaseEditor={openDatabaseEditor} onDelete={onDelete} />
        : !activeFederalQuery.isLoading && <Empty title="No matching federal project records" detail="Adjust your search or Active filter, or add a project to the register." />}
    </> : !filtered.length ? <Empty title="No matching project records" detail={emptyDetail} /> : isOnCallPage ? <RowNumberedTable className="data-table on-call-project-table" aria-label="On Call Non-PAS project details">
      <thead><tr><th>DIR#</th><th>PA/BL ##</th><th className="on-call-project-name-column">Proj name</th><th>Prime contractor</th><th>Project started?</th><th>LCP</th><th>DIR</th><th>PWC-100 date</th><th>PWCR exp (once a year or every 3 years)</th><th>Last follow-up comments</th><th>Actions</th></tr></thead>
      <tbody>{filtered.map((p: Project) => {
        const started = p.projectInitiationDate
          ? <><Status value="Started" /><div className="table-secondary">{dateLabel(p.projectInitiationDate)}</div></>
          : <Status value="Not started" />;
        const lcpStatus = projectEntryStatusLabel(p.registrationStatus) || 'Not checked';
        const dirStatus = projectEntryStatusLabel(p.payrollFormsStatus) || 'Not checked';
        return <tr key={p.id} data-testid={`row-on-call-project-${p.id}`}>
          <td data-label="DIR#">{p.dirNumber || '—'}</td>
          <td data-label="PA/BL ##"><div>{p.projectNumber || '—'}</div><div className="table-secondary">Prime Approver: {p.primeApprover || '—'}</div></td>
          <td data-label="Proj name"><span className="table-primary">{p.projectName}</span></td>
          <td data-label="Prime contractor">{p.contractorName || '—'}</td>
          <td data-label="Project started?">{started}</td>
          <td data-label="LCP" className="status-cell"><ComplianceStatusWithBypass value={lcpStatus} bypass={p.registrationBypass} bypassStatus={p.registrationBypassStatus} />{p.registrationCheckedOn && <div className="table-secondary">Date: {dateLabel(p.registrationCheckedOn)}</div>}</td>
          <td data-label="DIR" className="status-cell"><ComplianceStatusWithBypass value={dirStatus} bypass={p.payrollFormsBypass} bypassStatus={p.payrollFormsBypassStatus} />{p.payrollFormsCheckedOn && <div className="table-secondary">Date: {dateLabel(p.payrollFormsCheckedOn)}</div>}</td>
          <td data-label="PWC-100 date">{p.pwc100 && p.pwc100RegisteredDate ? dateLabel(p.pwc100RegisteredDate) : '—'}</td>
          <td data-label="PWCR exp">{p.designPwcrExpirationDate ? dateLabel(p.designPwcrExpirationDate) : '—'}</td>
          <td data-label="Last follow-up comments"><CommentsPreview projectId={p.id} projectName={p.projectName} comments={p.complianceNotes} /></td>
          <td className="record-actions-cell" data-label="Actions"><RecordRowActions recordType="project" recordId={p.id} title={p.projectName} onEdit={() => onEdit('project', p)} onDelete={onDelete} /></td>
        </tr>;
      })}</tbody>
    </RowNumberedTable> : isProjectSectionPage ? <RowNumberedTable className="data-table project-entry-template-table" aria-label={`${pageTitle} project entry fields`}>
      <colgroup><col style={{ width: '10%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} /><col style={{ width: '5%' }} /><col style={{ width: '6%' }} /><col style={{ width: '6%' }} /><col style={{ width: '6%' }} /><col style={{ width: '6%' }} /><col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} /><col style={{ width: '5%' }} /><col style={{ width: '6%' }} /><col style={{ width: '2%' }} /></colgroup>
      <thead><tr><th>Proj Name</th><th>Proj Num</th><th>Contractor</th><th>LCP</th><th>DIR#</th><th>DIR</th><th>Forms status</th><th>Date of project initiation</th><th>Date of project finish</th><th>On PWC-100?</th><th>Project Type</th><th>Prime Approver</th><th>Design week</th><th>PWCR expiration</th><th>Comments</th><th>Actions</th></tr></thead>
      <tbody>{filtered.map((p: Project) => {
        const lcpStatus = projectEntryStatusLabel(p.registrationStatus);
        const dirStatus = projectEntryStatusLabel(p.payrollFormsStatus);
        const projectTypes = [p.federalProject && 'Federal project', p.designProject && 'Design project', p.onCall && 'On call', p.pasCipDpw && 'PAS CIP+DPW'].filter(Boolean).join(', ');
        return <tr key={p.id} data-testid={`row-project-${p.id}`}>
          <td data-label="Proj Name" className="table-primary">{p.projectName}</td>
          <td data-label="Proj Num">{p.projectNumber}</td>
          <td data-label="Contractor">{p.contractorName}</td>
          <td data-label="LCP" className="status-cell">{lcpStatus && <ComplianceStatusWithBypass value={lcpStatus} bypass={p.registrationBypass} bypassStatus={p.registrationBypassStatus} />}{p.registrationCheckedOn && <div className="table-secondary">Date: {dateLabel(p.registrationCheckedOn)}</div>}</td>
          <td data-label="DIR#">{p.dirNumber || '—'}</td>
          <td data-label="DIR" className="status-cell">{dirStatus && <ComplianceStatusWithBypass value={dirStatus} bypass={p.payrollFormsBypass} bypassStatus={p.payrollFormsBypassStatus} />}{p.payrollFormsCheckedOn && <div className="table-secondary">Date: {dateLabel(p.payrollFormsCheckedOn)}</div>}</td>
          <td data-label="Forms status">{p.formsStatus ? <Status value={formsStatusBucket(p.formsStatus)} /> : ''}<div className="pas-form-statuses">
            {[p.form1Status, p.form2Status, p.form3Status, p.form4Status].map((formStatus: string, index: number) => <div key={index}>Form {index + 1}: {formStatus || 'Not checked'}</div>)}
          </div></td>
          <td data-label="Date of project initiation">{p.projectInitiationDate ? dateLabel(p.projectInitiationDate) : ''}</td>
          <td data-label="Date of project finish">{p.projectFinishDate ? dateLabel(p.projectFinishDate) : ''}</td>
          <td data-label="On PWC-100?">{p.pwc100 ? <><div>Yes</div>{p.pwc100RegisteredDate && <div className="table-secondary">Registered: {dateLabel(p.pwc100RegisteredDate)}</div>}{p.pwc100ExpirationDate && <div className="table-secondary">Expired: {dateLabel(p.pwc100ExpirationDate)}</div>}</> : 'No'}</td>
          <td data-label="Project Type">{projectTypes}</td>
          <td data-label="Prime Approver">{p.designProjectManager}<div className="table-secondary">{p.designProjectManagerEmail}</div></td>
          <td data-label="Design week">{p.designWeekStart && <div>Start: {dateLabel(p.designWeekStart)}</div>}{p.designWeekEnd && <div>End: {dateLabel(p.designWeekEnd)}</div>}</td>
          <td data-label="PWCR expiration">{p.designPwcrExpirationDate ? dateLabel(p.designPwcrExpirationDate) : ''}</td>
          <td data-label="Comments"><CommentsPreview projectId={p.id} projectName={p.projectName} comments={p.complianceNotes} /></td>
          <td className="record-actions-cell" data-label="Actions"><RecordRowActions recordType="project" recordId={p.id} title={p.projectName} onEdit={() => onEdit('project', p)} onDelete={onDelete} /></td>
        </tr>;
      })}</tbody>
    </RowNumberedTable> : <RowNumberedTable className="data-table"><thead><tr><th>Project</th><th>Contractor</th><th>Labor compliance</th><th>DIR #</th><th>DIR status</th><th>Forms</th><th>Payment due</th><th>Comments</th><th>Actions</th></tr></thead><tbody>{filtered.map((p: Project) => <tr key={p.id} data-testid={`row-project-${p.id}`}>
      <td><div className="table-primary">{p.projectName}</div><div className="table-secondary">{p.projectNumber || p.projectKey}</div><div className="table-secondary">Types: {[p.federalProject && 'Federal', p.designProject && 'Design', p.onCall && 'On call', p.pasCipDpw && 'PAS CIP+DPW'].filter(Boolean).join(', ') || 'Not selected'}</div></td><td>{p.contractorName || '—'}</td><td className="status-cell"><ComplianceStatusWithBypass value={complianceStatusBucket(p.registrationStatus)} bypass={p.registrationBypass} bypassStatus={p.registrationBypassStatus} /><div className="table-secondary">Checked {dateLabel(p.registrationCheckedOn)}</div></td><td>{p.dirNumber || '—'}</td><td className="status-cell"><ComplianceStatusWithBypass value={complianceStatusBucket(p.payrollFormsStatus)} bypass={p.payrollFormsBypass} bypassStatus={p.payrollFormsBypassStatus} /><div className="table-secondary">Checked {dateLabel(p.payrollFormsCheckedOn)}</div></td><td className="status-cell"><Status value={formsStatusBucket(p.formsStatus)} /><div className="pas-form-statuses">{[p.form1Status, p.form2Status, p.form3Status, p.form4Status].map((formStatus: string, index: number) => <div key={index}>Form {index + 1}: {formStatus || 'Not checked'}</div>)}</div></td><td>{dateLabel(p.paymentDueDate)}{p.latePayment && <div className="table-secondary" style={{ color: '#a34d3d' }}>Past due</div>}</td><td><CommentsPreview projectId={p.id} projectName={p.projectName} comments={p.complianceNotes} /></td><td className="record-actions-cell" data-label="Actions"><RecordRowActions recordType="project" recordId={p.id} title={p.projectName} onEdit={() => onEdit('project', p)} onDelete={onDelete} /></td>
    </tr>)}</tbody></RowNumberedTable>}</section></TableScrollRegion>
  </>;
}
function ContractorsPage({ contractors, projects, loading, error, retry, onAdd, onEdit, onLinksChanged, onDelete }: {
  contractors: Contractor[];
  projects: Project[];
  loading: boolean;
  error: boolean;
  retry: () => void;
  onAdd: (kind: Kind) => void;
  onEdit: (kind: Kind, record: Contractor | Project) => void;
  onLinksChanged: () => void;
  onDelete: (recordType: TrashRecordType, id: number, title: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'primary' | 'subcontractors'>('primary');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState('name:asc');
  const [projectSummarySort, setProjectSummarySort] = useState<ContractorProjectSortOrder>('name:asc');
  const [expandedContractors, setExpandedContractors] = useState<Set<number>>(() => new Set());
  const [expandedSubcontractors, setExpandedSubcontractors] = useState<Set<number>>(() => new Set());
  const [expandedProjectGroups, setExpandedProjectGroups] = useState<Set<string>>(() => new Set());
  const [editingLink, setEditingLink] = useState<{ linkId: number; projectId: string; projectType: string } | null>(null);
  const [linkActionError, setLinkActionError] = useState('');
  const [linkErrorId, setLinkErrorId] = useState<number | null>(null);
  const [deleteLinkConfirmation, setDeleteLinkConfirmation] = useState<{ linkId: number; subcontractorName: string; projectName: string } | null>(null);
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewPage, setReviewPage] = useState(0);
  const [reviewSort, setReviewSort] = useState('source');
  const [workbookRelationships, setWorkbookRelationships] = useState<WorkbookContractorRelationship[] | null>(null);
  const [workbookSourceError, setWorkbookSourceError] = useState(false);
  const updateLink = useUpdateContractorSubcontractorLink();
  const trashLink = useMoveRecordToTrash();
  const linkActionPending = updateLink.isPending || trashLink.isPending;
  const editSubcontractorName = (subcontractorId: number) => {
    const contractorRecord = contractors.find((contractor) => contractor.id === subcontractorId);
    if (contractorRecord) onEdit('contractor', contractorRecord);
  };
  useEffect(() => {
    let cancelled = false;
    import('./data/svProjContractorRelationships.json')
      .then(({ default: records }) => {
        if (!cancelled) setWorkbookRelationships(records as WorkbookContractorRelationship[]);
      })
      .catch(() => {
        if (!cancelled) setWorkbookSourceError(true);
      });
    return () => { cancelled = true; };
  }, []);
  const relationshipAudit = useMemo(
    () => workbookRelationships
      ? auditContractorRelationships(workbookRelationships, projects, contractors)
      : { inSyncCount: 0, reviewRows: [] },
    [workbookRelationships, projects, contractors],
  );
  const filteredReviewRows = relationshipAudit.reviewRows.filter((row) =>
    `${row.sourceSheet} ${row.sourceRows.join(' ')} ${row.sourceProjectName} ${row.sourceProjectNumbers.join(' ')} ${row.sourceRole} ${row.sourceContractorName} ${row.appProjectName} ${row.appProjectNumber} ${row.appPrimaryContractor} ${row.appContractorMatch} ${row.appContractorCandidates.map((candidate) => `${candidate.name} ${candidate.id}`).join(' ')} ${row.reason}`
      .toLocaleLowerCase()
      .includes(reviewSearch.trim().toLocaleLowerCase()),
  );
  const sortedReviewRows = sortRows(filteredReviewRows, reviewSort, {
    project: (row) => row.sourceProjectName || row.appProjectName,
    contractor: (row) => row.sourceContractorName,
    type: (row) => row.sourceRole,
  });
  const reviewPageSize = 25;
  const reviewPageCount = Math.max(1, Math.ceil(sortedReviewRows.length / reviewPageSize));
  const currentReviewPage = Math.min(reviewPage, reviewPageCount - 1);
  const reviewPageItems = sortedReviewRows.slice(currentReviewPage * reviewPageSize, (currentReviewPage + 1) * reviewPageSize);
  const reviewSortOptions: SortOption[] = [
    { value: 'source', label: 'Workbook order' },
    { value: 'project', label: 'Project name' },
    { value: 'contractor', label: 'Contractor name' },
    { value: 'type', label: 'Entry type' },
  ];
  const projectSummarySortOptions: SortOption[] = [
    { value: 'name:asc', label: 'Project name A–Z' },
    { value: 'name:desc', label: 'Project name Z–A' },
    { value: 'number:asc', label: 'Project number low–high' },
    { value: 'number:desc', label: 'Project number high–low' },
    { value: 'subcontractors:desc', label: 'Most subcontractors' },
    { value: 'subcontractors:asc', label: 'Fewest subcontractors' },
  ];
  const query = search.trim().toLowerCase();
  const list = sortRows(contractors.filter((contractor) =>
    `${contractor.name} ${contractor.aliases} ${contractor.sourceSheets || ''}`
      .toLowerCase()
      .includes(query),
  ), sortBy, {
    name: (contractor) => contractor.name,
    projects: (contractor) => contractor.projectCount,
    subcontractors: (contractor) => contractor.subcontractorCount,
  });
  const allSubcontractors = buildSubcontractorDirectory(contractors, projects);
  const subcontractorList = allSubcontractors.filter((subcontractor) => {
    const searchable = [
      subcontractor.name,
      ...subcontractor.projects.flatMap((project) => [
        project.projectName,
        project.projectNumber,
        project.primaryContractorName,
      ]),
    ].join(' ').toLowerCase();
    return searchable.includes(query);
  });
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil((activeTab === 'primary' ? list.length : subcontractorList.length) / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = list.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const subcontractorPageItems = subcontractorList.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <>
    <PageHeader eyebrow="Directory · SQL Server records" title="Contractors" description="Browse primary contractors and their linked subcontractors." action={<button className="btn btn-primary" onClick={() => onAdd('contractor')}><Plus /> Add contractor</button>} />
    <div className="contractor-directory-tabs" role="tablist" aria-label="Contractor directory sections">
      <button type="button" role="tab" aria-selected={activeTab === 'primary'} aria-controls="primary-contractors-panel" id="primary-contractors-tab" className={activeTab === 'primary' ? 'active' : ''} onClick={() => { setActiveTab('primary'); setPage(0); }}>
        Primary Contractors <span>{contractors.length}</span>
      </button>
      <button type="button" role="tab" aria-selected={activeTab === 'subcontractors'} aria-controls="subcontractors-panel" id="subcontractors-tab" className={activeTab === 'subcontractors' ? 'active' : ''} onClick={() => { setActiveTab('subcontractors'); setPage(0); }}>
        Sub Contractors <span>{allSubcontractors.length}</span>
      </button>
    </div>
    <div className="tools-row">
      <TextFilter value={search} onChange={value => { setSearch(value); setPage(0); }} placeholder={activeTab === 'primary' ? 'Search primary contractors or aliases…' : 'Search subcontractors or projects…'} />
      {activeTab === 'primary' && <SortByControl value={sortBy} onChange={(value) => { setSortBy(value); setPage(0); }} options={[
      { value: 'name:asc', label: 'Contractor A–Z' },
      { value: 'name:desc', label: 'Contractor Z–A' },
      { value: 'projects:desc', label: 'Most projects' },
      { value: 'projects:asc', label: 'Fewest projects' },
      { value: 'subcontractors:desc', label: 'Most subcontractors' },
      { value: 'subcontractors:asc', label: 'Fewest subcontractors' },
      ]} />}
      <span className="refresh-label">{activeTab === 'primary' ? `${list.length} primary contractors` : `${subcontractorList.length} subcontractors`}</span>
    </div>
    {activeTab === 'primary' && <TableScrollRegion><section className="panel table-wrap contractor-directory-wrap" id="primary-contractors-panel" role="tabpanel" aria-labelledby="primary-contractors-tab">{error ? <ErrorBox retry={retry} /> : loading ? <div className="loading-state">Loading contractor records…</div> : !list.length ? <Empty title="No matching primary contractors" detail="Add a contractor or broaden your search." /> : <RowNumberedTable className="data-table contractor-directory-table"><thead><tr><th>Primary Contractor</th><th># of projects</th><th># Of Sub Contractors</th><th>Actions</th></tr></thead><tbody>{pageItems.map((contractor) => {
      const isExpanded = expandedContractors.has(contractor.id);
      const projectGroups = sortContractorProjectGroups(
        groupContractorProjects(contractor.id, projects, contractor.subcontractors ?? []),
        projectSummarySort,
      );
      const contractorDetailsId = `contractor-${contractor.id}-project-details`;
      return <Fragment key={contractor.id}><tr>
        <td><div className="contractor-primary-cell"><span className="table-primary">{contractor.name}</span></div>
          <button type="button" className="contractor-view-info" data-testid={`button-view-info-${contractor.id}`} aria-expanded={isExpanded} aria-controls={contractorDetailsId} onClick={() => setExpandedContractors((current) => {
            const next = new Set(current);
            if (next.has(contractor.id)) next.delete(contractor.id);
            else next.add(contractor.id);
            return next;
          })}><ChevronDown className={isExpanded ? 'is-expanded' : ''} />{isExpanded ? 'Hide info' : 'View info'}</button>
        </td>
        <td className="contractor-directory-count-cell">{contractor.projectCount}</td>
        <td className="contractor-directory-count-cell">{contractor.subcontractorCount}</td>
        <td className="record-actions-cell" data-label="Actions"><RecordRowActions recordType="contractor" recordId={contractor.id} title={contractor.name} onEdit={() => onEdit('contractor', contractor)} onDelete={onDelete} /></td>
      </tr>
      <tr className="contractor-directory-details-row" hidden={!isExpanded}><td colSpan={4} id={contractorDetailsId}>
        <div className="contractor-subcontractor-dropdown">
          <div className="contractor-status-legend"><span>Status: incomplete to complete</span><Check aria-hidden="true" /></div>
          {projectGroups.length ? <div className="contractor-project-groups" data-testid={`contractor-project-groups-${contractor.id}`}>
            <SortByControl
              value={projectSummarySort}
              onChange={(value) => setProjectSummarySort(value as ContractorProjectSortOrder)}
              options={projectSummarySortOptions}
              label="Sort projects"
            />
            <div className="contractor-project-info-header">
              <span>Project Name</span>
              <span>Project Number</span>
              <span># of subs</span>
            </div>
            {projectGroups.map((group) => {
              const groupKey = `${contractor.id}:${group.projectId}`;
              const isSubsExpanded = expandedProjectGroups.has(groupKey);
              const detailsId = `contractor-${contractor.id}-project-${group.projectId}-subs`;
              const subcontractors = incompleteSubcontractorsFirst(group.subcontractors);
              return <section className="contractor-project-card" key={group.projectId} data-testid={`contractor-project-${contractor.id}-${group.projectId}`}>
                <div className="contractor-project-summary">
                  <div className="contractor-project-summary-copy">
                    <strong className="contractor-project-name"><span className="sr-only">Project Name: </span>{group.projectName || 'Project name unavailable'}</strong>
                    <span className="contractor-project-number"><span className="sr-only">Project Number: </span>{formatProjectNumberForDisplay(group.projectNumber) || '—'}</span>
                    <span className="contractor-project-count" data-testid={`project-subcontractor-count-${contractor.id}-${group.projectId}`}>
                      <span className="sr-only">Number of subcontractors: </span>
                      {group.subcontractors.length} {group.subcontractors.length === 1 ? 'subcontractor' : 'subcontractors'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="contractor-project-subs-toggle"
                    data-testid={`button-view-subs-${contractor.id}-${group.projectId}`}
                    aria-expanded={isSubsExpanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedProjectGroups((current) => {
                      const next = new Set(current);
                      if (next.has(groupKey)) next.delete(groupKey);
                      else next.add(groupKey);
                      return next;
                    })}
                  >
                    {isSubsExpanded ? 'Hide Subs' : 'View Subs'}
                    <ChevronDown className={isSubsExpanded ? 'is-expanded' : ''} aria-hidden="true" />
                  </button>
                </div>
                <div id={detailsId} className="contractor-project-subs" data-testid={`project-subs-${contractor.id}-${group.projectId}`} hidden={!isSubsExpanded}>
                  {isSubsExpanded && (subcontractors.length ? <div className="contractor-subcontractor-scroll-panel">
                    <RowNumberedTable className="data-table contractor-subcontractor-table" aria-label={`Subcontractors for ${contractor.name}, ${group.projectName || 'project'}`}>
                      <thead><tr><th>Status</th><th>Project Type</th><th>Sub Contractor</th><th>LCP</th><th>DIR</th><th>Actions</th></tr></thead>
                      <tbody>{subcontractors.map((detail) => <tr key={detail.id} data-testid={`subcontractor-info-${detail.id}`}>
                <td><Status value={detail.completionStatus} /></td>
                <td>{editingLink?.linkId === detail.linkId && detail.linkId !== null ? <select
                  className="field"
                  aria-label={`Project for ${detail.subcontractorName}`}
                  data-testid={`select-edit-subcontractor-project-${detail.linkId}`}
                  value={editingLink.projectId}
                  onChange={(event) => {
                    const projectId = event.target.value;
                    const project = projects.find((candidate) => String(candidate.id) === projectId);
                    const types = subContractorProjectTypes(project);
                    setEditingLink((current) => current ? {
                      ...current,
                      projectId,
                      projectType: types[0]?.value ?? '',
                    } : current);
                  }}
                ><option value="">Select project…</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.projectName}</option>)}</select> : detail.projectType}</td>
                <td><div className="contractor-primary-cell"><span className="table-primary">{detail.subcontractorName}</span><button type="button" className="table-action" aria-label={`Edit subcontractor name ${detail.subcontractorName}`} title="Edit subcontractor name" data-testid={`button-edit-subcontractor-name-${detail.subcontractorId}`} disabled={!contractors.some((contractor) => contractor.id === detail.subcontractorId)} onClick={() => editSubcontractorName(detail.subcontractorId)}><SlidersHorizontal /></button></div></td>
                <td><div>{detail.lcpStatus || 'Not checked'}</div>{detail.projectRegistrationBypass && <span className="compliance-bypass-badge" title="Bypass setting on the linked project">Project bypass: {detail.projectRegistrationBypassStatus || 'Not selected'}</span>}</td>
                <td><div>{detail.dirStatus || 'Not checked'}</div>{detail.projectPayrollFormsBypass && <span className="compliance-bypass-badge" title="Bypass setting on the linked project">Project bypass: {detail.projectPayrollFormsBypassStatus || 'Not selected'}</span>}</td>
                <td className="record-actions-cell" data-label="Actions">{detail.linkId !== null && detail.linkId !== undefined ? editingLink?.linkId === detail.linkId ? <div className="contractor-subcontractor-actions record-row-actions">
                  <button type="button" className="btn btn-primary" data-testid={`button-save-subcontractor-link-${detail.linkId}`} disabled={linkActionPending || !editingLink.projectId || !editingLink.projectType} onClick={() => {
                    setLinkActionError('');
                    setLinkErrorId(detail.linkId);
                    updateLink.reset();
                    updateLink.mutate({
                      id: detail.linkId!,
                      data: { projectId: Number(editingLink.projectId), projectType: editingLink.projectType as 'Federal' | 'Design' | 'On Call' | 'PAS CIP+DPW' },
                    }, {
                      onSuccess: () => {
                        onLinksChanged();
                        setEditingLink(null);
                      },
                      onError: (mutationError) => setLinkActionError(mutationError.message || 'Unable to update this subcontractor link.'),
                    });
                  }}>{linkActionPending ? 'Saving…' : 'Save'}</button>
                  <button type="button" className="btn" disabled={linkActionPending} onClick={() => { setEditingLink(null); setLinkActionError(''); setLinkErrorId(null); }}>Cancel</button>
                </div> : <div className="contractor-subcontractor-actions record-row-actions">
                  <button type="button" className="table-action" aria-label={`Edit link for ${detail.subcontractorName}`} title="Edit subcontractor link" data-testid={`button-edit-subcontractor-link-${detail.linkId}`} disabled={linkActionPending} onClick={() => {
                    const project = projects.find((candidate) => candidate.id === detail.projectId);
                    const types = subContractorProjectTypes(project);
                    setEditingLink({
                      linkId: detail.linkId!,
                      projectId: String(detail.projectId),
                      projectType: types.some((type) => type.value === detail.projectType) ? detail.projectType : types[0]?.value ?? '',
                    });
                    setLinkActionError('');
                    setLinkErrorId(null);
                    updateLink.reset();
                    trashLink.reset();
                  }}><SlidersHorizontal /></button>
                  <button type="button" className="table-action table-delete-action" aria-label={`Delete subcontractor link for ${detail.subcontractorName}`} title="Delete subcontractor link" data-testid={`button-remove-subcontractor-link-${detail.linkId}`} disabled={linkActionPending} onClick={() => {
                    setLinkActionError('');
                    setLinkErrorId(detail.linkId);
                    trashLink.reset();
                    setDeleteLinkConfirmation({ linkId: detail.linkId!, subcontractorName: detail.subcontractorName, projectName: group.projectName });
                  }}><Trash2 /></button>
                </div> : '—'}{linkErrorId === detail.linkId && linkActionError && <span className="design-save-error" role="alert">{linkActionError}</span>}</td>
              </tr>)}</tbody>
                    </RowNumberedTable>
          </div> : <div className="contractor-inline-empty" data-testid={`project-subs-empty-${contractor.id}-${group.projectId}`}>No subcontractors are linked to this project.</div>)}
                </div>
              </section>;
            })}
          </div> : <div className="contractor-inline-empty" data-testid={`contractor-projects-empty-${contractor.id}`}>No project details are available for this contractor.</div>}
        </div>
      </td></tr>
      </Fragment>;
    })}</tbody></RowNumberedTable>}</section></TableScrollRegion>}
    {activeTab === 'subcontractors' && <TableScrollRegion><section className="panel table-wrap contractor-directory-wrap subcontractor-directory-wrap" id="subcontractors-panel" role="tabpanel" aria-labelledby="subcontractors-tab">
      {error ? <ErrorBox retry={retry} /> : loading ? <div className="loading-state">Loading subcontractor records…</div> : !subcontractorList.length ? <Empty title="No linked subcontractors found" detail="Subcontractors appear here after they are linked to a project with a primary contractor." /> : <RowNumberedTable className="data-table contractor-directory-table subcontractor-directory-table">
        <thead><tr><th>Sub Contractor</th><th># of projects</th><th>Actions</th></tr></thead>
        <tbody>{subcontractorPageItems.map((subcontractor) => {
          const isExpanded = expandedSubcontractors.has(subcontractor.subcontractorId);
          const detailsId = `subcontractor-${subcontractor.subcontractorId}-projects`;
          return <Fragment key={subcontractor.subcontractorId}>
            <tr data-testid={`subcontractor-directory-row-${subcontractor.subcontractorId}`}>
              <td><div className="contractor-primary-cell"><span className="table-primary">{subcontractor.name}</span></div></td>
              <td className="contractor-directory-count-cell">
                <div className="subcontractor-project-count">
                  <strong>{subcontractor.projects.length}</strong>
                  <button type="button" className="contractor-view-info" data-testid={`button-show-subcontractor-projects-${subcontractor.subcontractorId}`} aria-expanded={isExpanded} aria-controls={detailsId} onClick={() => setExpandedSubcontractors((current) => {
                    const next = new Set(current);
                    if (next.has(subcontractor.subcontractorId)) next.delete(subcontractor.subcontractorId);
                    else next.add(subcontractor.subcontractorId);
                    return next;
                  })}>
                    {isExpanded ? 'Hide Projects' : 'Show Projects'}
                    <ChevronDown className={isExpanded ? 'is-expanded' : ''} aria-hidden="true" />
                  </button>
                </div>
              </td>
              <td className="record-actions-cell" data-label="Actions">{contractors.some((contractor) => contractor.id === subcontractor.subcontractorId) && <RecordRowActions recordType="contractor" recordId={subcontractor.subcontractorId} title={subcontractor.name} editTestId={`button-edit-subcontractor-directory-name-${subcontractor.subcontractorId}`} onEdit={() => editSubcontractorName(subcontractor.subcontractorId)} onDelete={onDelete} />}</td>
            </tr>
            <tr className="contractor-directory-details-row" hidden={!isExpanded}>
      <td colSpan={3} id={detailsId}>
                {isExpanded && <div className="subcontractor-projects-panel">
                  <RowNumberedTable className="data-table subcontractor-projects-table" aria-label={`Projects for ${subcontractor.name}`}>
                    <thead><tr><th>Project Name</th><th>Project Number</th><th>Project Type</th><th>LCP</th><th>DIR</th><th>Primary Contractor</th><th>Actions</th></tr></thead>
                    <tbody>{subcontractor.projects.map((project) => <tr key={project.projectId} data-testid={`subcontractor-project-${subcontractor.subcontractorId}-${project.projectId}`}>
                      <td className="table-primary">{project.projectName}</td>
                      <td>{formatProjectNumberForDisplay(project.projectNumber) || '—'}</td>
                      <td>{project.projectType}</td>
                      <td><Status value={complianceStatusBucket(project.lcpStatus)} /></td>
                      <td><Status value={complianceStatusBucket(project.dirStatus)} /></td>
                      <td>{project.primaryContractorName || '—'}</td>
                      <td className="record-actions-cell" data-label="Actions">{(() => {
                        const record = projects.find((candidate) => candidate.id === project.projectId);
                        return record ? <RecordRowActions recordType="project" recordId={record.id} title={project.projectName} onEdit={() => onEdit('project', record)} onDelete={onDelete} /> : null;
                      })()}</td>
                    </tr>)}</tbody>
                  </RowNumberedTable>
                </div>}
              </td>
            </tr>
          </Fragment>;
        })}</tbody>
      </RowNumberedTable>}
    </section></TableScrollRegion>}
    {pageCount > 1 && <nav className="contractor-pagination" aria-label={`${activeTab === 'primary' ? 'Primary contractor' : 'Subcontractor'} pages`}>
      <span>Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, activeTab === 'primary' ? list.length : subcontractorList.length)} of {activeTab === 'primary' ? list.length : subcontractorList.length} {activeTab === 'primary' ? 'primary contractors' : 'subcontractors'}</span>
      <div className="contractor-pagination-controls">
        <button type="button" className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage + 1} of {pageCount}</span>
        <button type="button" className="btn" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button>
      </div>
    </nav>}
    <section className="panel contractor-workbook-review" aria-labelledby="contractor-workbook-review-title">
      <div className="contractor-workbook-review-head">
        <div>
          <div className="eyebrow">SV PROJ SHETS · read-only comparison</div>
          <h2 id="contractor-workbook-review-title">Workbook relationship review</h2>
          <p>Exact workbook matches and app-only relationships are compared both ways. Unclear entries stay here for review; no workbook assignments have been written to SQL.</p>
        </div>
        <div className="contractor-review-counts" aria-label="Workbook comparison totals">
          <span><strong>{loading || error || !workbookRelationships ? '—' : relationshipAudit.inSyncCount}</strong> in sync</span>
          <span><strong>{loading || error || !workbookRelationships ? '—' : relationshipAudit.reviewRows.length}</strong> to review</span>
        </div>
      </div>
      {loading || (!workbookRelationships && !workbookSourceError) ? <div className="loading-state">Loading app records and SV workbook data…</div> : error || workbookSourceError ? <div className="contractor-review-warning" role="status">The app records or SV workbook data could not be loaded, so the comparison is unavailable.</div> : <>
        <div className="contractor-review-toolbar">
          <TextFilter value={reviewSearch} onChange={(value) => { setReviewSearch(value); setReviewPage(0); }} placeholder="Search workbook rows, projects, contractors…" />
          <SortByControl value={reviewSort} onChange={(value) => { setReviewSort(value); setReviewPage(0); }} options={reviewSortOptions} />
          <span className="refresh-label">{filteredReviewRows.length} review rows</span>
        </div>
        {!filteredReviewRows.length ? <Empty title="No workbook rows need review" detail="Every recognized contractor relationship matches the current app records." /> : <TableScrollRegion><div className="table-wrap contractor-review-table-wrap">
          <RowNumberedTable className="data-table contractor-review-table">
            <thead><tr><th>Workbook source</th><th>Workbook project</th><th>Workbook entry</th><th>App project</th><th>Current app contractors</th><th>Why it needs review</th></tr></thead>
            <tbody>{reviewPageItems.map((row) => <tr key={row.key} data-testid={`workbook-review-${row.key}`}>
              <td><span>{row.sourceSheet}</span><small>{row.sourceRows.length ? `Excel row${row.sourceRows.length > 1 ? 's' : ''} ${row.sourceRows.join(', ')}` : 'Current app relationship'}</small></td>
              <td><span>{row.sourceProjectName || 'Project name missing'}</span><small>{row.sourceProjectNumbers.length ? row.sourceProjectNumbers.join(' · ') : 'Project number missing'}</small></td>
              <td><span className={`contractor-review-role contractor-review-role-${row.sourceRole.toLocaleLowerCase().replace(/\s+/g, '-')}`}>{row.sourceRole}</span><small>{row.sourceContractorName}</small></td>
              <td><span>{row.appProjectName || 'No exact project match'}</span><small>{row.appProjectNumber || '—'}</small></td>
              <td><span>Primary: {row.appPrimaryContractor || '—'}</span>{row.appContractorCandidates.length > 1
                ? <small>Matching records: {row.appContractorCandidates.map((candidate) => `${candidate.name} (ID ${candidate.id})`).join('; ')}</small>
                : <small>Contractor match: {row.appContractorMatch || 'No exact match'}</small>}</td>
              <td className="contractor-review-reason">{row.reason}</td>
            </tr>)}</tbody>
          </RowNumberedTable>
        </div></TableScrollRegion>}
        {reviewPageCount > 1 && <nav className="contractor-pagination contractor-review-pagination" aria-label="Workbook review pages">
          <span>Showing {currentReviewPage * reviewPageSize + 1}–{Math.min((currentReviewPage + 1) * reviewPageSize, filteredReviewRows.length)} of {filteredReviewRows.length} review rows</span>
          <div className="contractor-pagination-controls">
            <button type="button" className="btn" disabled={currentReviewPage === 0} onClick={() => setReviewPage(currentReviewPage - 1)}>Previous</button>
            <span>Page {currentReviewPage + 1} of {reviewPageCount}</span>
            <button type="button" className="btn" disabled={currentReviewPage >= reviewPageCount - 1} onClick={() => setReviewPage(currentReviewPage + 1)}>Next</button>
          </div>
        </nav>}
      </>}
    </section>
    {deleteLinkConfirmation && <ConfirmDeleteDialog
      heading="Remove this subcontractor link?"
      recordTitle={`${deleteLinkConfirmation.subcontractorName} · ${deleteLinkConfirmation.projectName}`}
      confirmLabel="Remove link"
      pending={trashLink.isPending}
      error={linkActionError}
      onCancel={() => {
        if (trashLink.isPending) return;
        setDeleteLinkConfirmation(null);
        setLinkActionError('');
        setLinkErrorId(null);
        trashLink.reset();
      }}
      onConfirm={() => {
        if (!deleteLinkConfirmation || trashLink.isPending) return;
        setLinkActionError('');
        trashLink.reset();
        trashLink.mutate({ recordType: 'subcontractorLink', recordId: deleteLinkConfirmation.linkId }, {
          onSuccess: () => {
            onLinksChanged();
            setDeleteLinkConfirmation(null);
          },
          onError: (mutationError) => setLinkActionError(mutationError.message || 'Unable to remove this subcontractor link.'),
        });
      }}
    />}
  </>;
}
function WithholdingsPage({ withholdings, loading, error, retry, onAdd, onEdit, onDelete }: any) {
  const [search, setSearch] = useState(''); const [unreleasedOnly, setUnreleasedOnly] = useState(false);
  const [sortBy, setSortBy] = useState('noticeDate:desc');
  const list = sortRows(withholdings.filter((w: Withholding) => `${w.projectName} ${w.contractorName} ${w.invoiceReference} ${w.reason}`.toLowerCase().includes(search.toLowerCase()) && (!unreleasedOnly || !w.released)), sortBy, {
    project: (w: Withholding) => w.projectName,
    contractor: (w: Withholding) => w.contractorName,
    invoice: (w: Withholding) => w.invoiceReference,
    amount: (w: Withholding) => w.amountWithheld,
    noticeDate: (w: Withholding) => w.notificationDate,
    status: (w: Withholding) => w.released ? 'Released' : 'Unreleased',
  });
  const total = list.filter((w: Withholding) => !w.released).reduce((sum: number, w: Withholding) => sum + Number(w.amountWithheld || 0), 0);
  return <><PageHeader eyebrow="Payment controls · Record history retained" title="Withholdings" description="Manage payment holds, notices and release references." action={<button className="btn btn-primary" onClick={() => onAdd('withholding')}><Plus /> Add withholding</button>} /><div className="tools-row"><TextFilter value={search} onChange={setSearch} placeholder="Search project, contractor, invoice…" /><SortByControl value={sortBy} onChange={setSortBy} options={[
      { value: 'noticeDate:desc', label: 'Newest notice' },
      { value: 'noticeDate:asc', label: 'Oldest notice' },
      { value: 'project:asc', label: 'Project A–Z' },
      { value: 'contractor:asc', label: 'Contractor A–Z' },
      { value: 'amount:desc', label: 'Highest amount' },
      { value: 'amount:asc', label: 'Lowest amount' },
      { value: 'status:asc', label: 'Status' },
      { value: 'invoice:asc', label: 'Invoice number' },
    ]} /><button className={`btn ${unreleasedOnly ? 'btn-primary' : ''}`} onClick={() => setUnreleasedOnly(!unreleasedOnly)}><SlidersHorizontal /> Unreleased only</button><span className="refresh-label">{money(total)} currently unreleased</span></div>
    <TableScrollRegion><section className="panel table-wrap">{error ? <ErrorBox retry={retry} /> : loading ? <div className="loading-state">Loading withholding records…</div> : !list.length ? <Empty title="No withholding records" detail="Payment hold records will appear here once added." /> : <RowNumberedTable className="data-table"><thead><tr><th>Project / contractor</th><th>Invoice</th><th>Amount</th><th>Notice date</th><th>Reason</th><th>Release</th><th>Status</th><th>Actions</th></tr></thead><tbody>{list.map((w: Withholding) => <tr key={w.id}><td><div className="table-primary">{projectReferenceLabel(w.projectName)}</div><div className="table-secondary">{w.contractorName || 'Contractor not linked'}</div></td><td className="mono">{w.invoiceReference || '—'}</td><td className="table-primary">{money(w.amountWithheld)}</td><td>{dateLabel(w.notificationDate) !== '—' ? dateLabel(w.notificationDate) : w.notificationDateText || '—'}</td><td>{w.reason || '—'}</td><td>{w.releaseDate ? <>{dateLabel(w.releaseDate)}<div className="table-secondary">{w.releaseReference}</div></> : '—'}</td><td><Status value={w.released ? 'Released' : 'Unreleased'} /></td><td className="record-actions-cell" data-label="Actions"><RecordRowActions recordType="withholding" recordId={w.id} title={w.invoiceReference || w.projectName || `Withholding ${w.id}`} onEdit={() => onEdit('withholding', w)} onDelete={onDelete} /></td></tr>)}</tbody></RowNumberedTable>}</section></TableScrollRegion>
  </>;
}

type WorkbookCell = { value?: string | null; formula?: string | null; type?: string; style?: number | null };
type WorkbookRowView = WorkbookSheetRow & { cells: Record<string, WorkbookCell> };
function excelColumnOrder(column: string) {
  return [...column].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}
function SourceSheetPage({ sheetName, onDelete }: { sheetName: string; onDelete: (recordType: TrashRecordType, id: number, title: string) => void }) {
  const { data, isLoading, isError, refetch } = useGetWorkbookSheetRows(sheetName, { query: { refetchInterval: 60_000, retry: false, refetchOnWindowFocus: true } });
  const openDatabaseEditor = useOpenDatabaseEditor();
  const [search, setSearch] = useState('');
  const [columnFilter, setColumnFilter] = useState('all');
  const [sortBy, setSortBy] = useState('excelRow:asc');
  const rows: WorkbookRowView[] = (data ?? []).map((row) => {
    try {
      return { ...row, cells: JSON.parse(row.cellsJson) as Record<string, WorkbookCell> };
    } catch {
      return { ...row, cells: {} };
    }
  });
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row.cells)))].sort((a, b) => excelColumnOrder(a) - excelColumnOrder(b));
  const filtered = rows.filter((row) => {
    const searchableCells = columnFilter === 'all'
      ? Object.values(row.cells)
      : [row.cells[columnFilter]];
    return searchableCells.some((cell) => {
      const value = `${cell?.value ?? ''} ${cell?.formula ?? ''}`.toLowerCase();
      return value.includes(search.toLowerCase());
    });
  });
  const sortOptions: SortOption[] = [
    { value: 'excelRow:asc', label: 'Excel row, low to high' },
    { value: 'excelRow:desc', label: 'Excel row, high to low' },
    ...columns.map((column) => ({ value: `column-${column}:asc`, label: `Column ${column}, A–Z` })),
  ];
  const sortedRows = sortRows(filtered, sortBy, {
    excelRow: (row) => row.excelRow,
    ...Object.fromEntries(columns.map((column) => [
      `column-${column}`,
      (row: WorkbookRowView) => row.cells[column]?.value ?? row.cells[column]?.formula ?? '',
    ])),
  });
  return <>
    <PageHeader eyebrow="Excel source sheet · Original cell data" title={sheetName} description="Original cell values and formulas are retained by worksheet row. Use search or choose a column to filter." />
    <div className="tools-row">
      <TextFilter value={search} onChange={setSearch} placeholder="Search values in this sheet…" />
      <select className="field select-field" aria-label="Filter a workbook column" value={columnFilter} onChange={(event) => setColumnFilter(event.target.value)}>
        <option value="all">All columns</option>
        {columns.map((column) => <option key={column} value={column}>Column {column}</option>)}
      </select>
      <SortByControl value={sortBy} onChange={setSortBy} options={sortOptions} />
      <span className="refresh-label">{filtered.length} of {rows.length} source rows</span>
    </div>
    <TableScrollRegion><section className="panel table-wrap">
      {isError ? <ErrorBox retry={() => void refetch()} /> : isLoading ? <div className="loading-state">Loading original worksheet rows…</div> : !filtered.length ? <Empty title="No matching source rows" detail="Adjust the search or column filter to see more rows." /> :
        <RowNumberedTable className="data-table"><thead><tr><th>Excel row</th>{columns.map((column) => <th key={column}>Column {column}</th>)}<th>Actions</th></tr></thead>
          <tbody>{sortedRows.map((row) => {
            const title = `${row.sourceSheet} row ${row.excelRow}`;
            return <tr key={row.id}>
              <td className="mono">{row.excelRow}</td>
              {columns.map((column) => {
                const cell = row.cells[column];
                const value = cell?.value ?? (cell?.formula ? `=${cell.formula}` : '');
                return <td key={column} title={cell?.formula ? `Formula: =${cell.formula}` : undefined} style={{ minWidth: 110, maxWidth: 320, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</td>;
              })}
              <td className="record-actions-cell" data-label="Actions"><RecordRowActions
                recordType="sourceRow"
                recordId={row.id}
                title={title}
                onEdit={() => openDatabaseEditor({
                  schemaName: 'labor_compliance_excel_stage',
                  tableName: 'SourceRows',
                  key: { Id: row.id },
                  initialRow: { Id: row.id, ExcelRow: row.excelRow, CellsJson: JSON.stringify(row.cells, null, 2) },
                })}
                onDelete={onDelete}
              /></td>
            </tr>;
          })}</tbody>
        </RowNumberedTable>}
    </section></TableScrollRegion>
  </>;
}

function databaseCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function databaseInputValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function DatabaseRowEditDialog({ request, onClose }: { request: DatabaseEditRequest; onClose: () => void }) {
  const client = useQueryClient();
  const { data: catalog, isLoading, isError } = useGetDatabaseTables({
    query: { retry: false, staleTime: 60_000 },
  });
  const mutation = useUpdateDatabaseTableRow();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [nullFields, setNullFields] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [validationError, setValidationError] = useState('');
  const isActiveFederalSourceEditor = request.editor === 'activeFederalSource' && request.tableName === 'SourceRows';
  const sourceExcelRow = Number(request.initialRow.ExcelRow);
  const [sourceCellDraft, setSourceCellDraft] = useState<Record<string, string>>(() => {
    try {
      const cells = JSON.parse(String(request.initialRow.CellsJson ?? '{}')) as Record<string, WorkbookCell>;
      return Object.fromEntries(activeFederalColumns.map(({ key }) => {
        const cell = cells[`${key}${sourceExcelRow}`];
        return [key, cell?.value ?? (cell?.formula ? `=${cell.formula}` : '')];
      }));
    } catch {
      return Object.fromEntries(activeFederalColumns.map(({ key }) => [key, '']));
    }
  });
  const [sourceDirNumberTouched, setSourceDirNumberTouched] = useState(false);
  const table = catalog?.tables.find(
    (candidate) => candidate.schemaName === request.schemaName && candidate.tableName === request.tableName,
  );
  const keyColumns = table?.columns.filter((column) => column.primaryKey) ?? [];
  const editableColumns = table?.columns.filter((column) => column.editable && column.name in request.initialRow) ?? [];
  const keyLabel = Object.entries(request.key).map(([name, value]) => `${name}: ${databaseCell(value)}`).join(' · ');
  const updateFederalSourceCell = (column: string, value: string) => {
    try {
      const cells = JSON.parse(String(draft.CellsJson ?? request.initialRow.CellsJson ?? '{}')) as Record<string, WorkbookCell>;
      const cellKey = `${column}${sourceExcelRow}`;
      const current = cells[cellKey] ?? {};
      const { formula: _formula, ...preserved } = current;
      cells[cellKey] = { ...preserved, value };
      setSourceCellDraft((currentDraft) => ({ ...currentDraft, [column]: value }));
      setDraft((currentDraft) => ({ ...currentDraft, CellsJson: JSON.stringify(cells, null, 2) }));
      setTouched((currentTouched) => ({ ...currentTouched, CellsJson: true }));
    } catch {
      setValidationError('The worksheet row could not be read. Close and reopen the editor before changing it.');
    }
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError('');
    if (!table || !keyColumns.length) {
      setValidationError('This table does not expose a stable primary key for row updates.');
      return;
    }
    if (isActiveFederalSourceEditor && sourceDirNumberTouched && !isValidDirNumber(sourceCellDraft.C.trim())) {
      setValidationError('DIR number must contain 6 or 11 digits.');
      return;
    }
    const values: DatabaseRowUpdate['values'] = {};
    for (const column of editableColumns) {
      if (!touched[column.name]) continue;
      const isNull = nullFields[column.name] ?? request.initialRow[column.name] === null;
      if (isNull) {
        values[column.name] = null;
        continue;
      }
      const value = draft[column.name] ?? databaseInputValue(request.initialRow[column.name]);
      const isDirNumberColumn = /^dirnumber$/i.test(column.name);
      if (isDirNumberColumn && !isNull && touched[column.name] && !isValidDirNumber(value.trim())) {
        setValidationError('DIR number must contain 6 or 11 digits.');
        return;
      }
      if (column.dataType.toLowerCase() === 'bit') {
        if (value !== 'true' && value !== 'false') {
          setValidationError(`${column.name} must be set to True or False.`);
          return;
        }
        values[column.name] = value === 'true';
      } else {
        if (column.name === 'CellsJson') {
          try {
            const parsed: unknown = JSON.parse(value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setValidationError('CellsJson must contain a JSON object.');
              return;
            }
          } catch {
            setValidationError('CellsJson must contain valid JSON.');
            return;
          }
        }
        values[column.name] = value;
      }
    }
    if (!Object.keys(values).length) {
      onClose();
      return;
    }
    const key: DatabaseRowUpdate['key'] = {};
    for (const column of keyColumns) {
      const value = request.key[column.name];
      if (value === null || value === undefined) {
        setValidationError(`The primary-key value for ${column.name} is missing.`);
        return;
      }
      key[column.name] = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : String(value);
    }
    mutation.mutate(
      { schemaName: request.schemaName, tableName: request.tableName, data: { key, values } },
      { onSuccess: () => { void client.invalidateQueries(); onClose(); } },
    );
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal" onSubmit={save} aria-labelledby="database-row-editor-title">
      <div className="modal-head">
        <div><div className="eyebrow">{request.schemaName} · {request.tableName}</div><h2 className="modal-title" id="database-row-editor-title">Edit database row</h2></div>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <div className="modal-body">
        <p className="field-help">Row key: {keyLabel || 'Unavailable'}. Key, identity, and calculated columns cannot be changed.</p>
        {request.tableName === 'SourceRows' && <div className="form-warning" role="note">Changes here edit the original imported worksheet snapshot in SQL Server. A later workbook refresh may replace these values.</div>}
        {request.notice && <div className="form-warning" role="note">{request.notice}</div>}
        {isLoading ? <div className="loading-state">Loading editable fields…</div>
          : isError || !table ? <div className="alert-message">Could not load this table’s edit rules. Refresh the page and retry.</div>
            : !keyColumns.length ? <div className="alert-message">This table has no primary key, so its rows cannot be updated safely.</div>
              : !editableColumns.length ? <div className="alert-message">This row has no editable columns.</div>
                : isActiveFederalSourceEditor ? <div className="form-grid">
                  {activeFederalColumns.map(({ key, label }) => {
                    const isDirNumber = key === 'C';
                    return <div className={`form-field ${key === 'H' ? 'full' : ''}`} key={key}>
                    <label htmlFor={`federal-source-${key}`}>{label} <span className="field-help-inline">(Column {key}{isDirNumber ? ' · 6 or 11 digits' : ''})</span></label>
                    {key === 'H'
                      ? <textarea id={`federal-source-${key}`} className="field" rows={4} value={sourceCellDraft[key] ?? ''} onChange={(event) => updateFederalSourceCell(key, event.target.value)} />
                      : <input
                          id={`federal-source-${key}`}
                          className="field"
                          type="text"
                          inputMode={isDirNumber ? 'numeric' : undefined}
                          maxLength={isDirNumber ? 11 : undefined}
                          pattern={isDirNumber && sourceDirNumberTouched ? DIR_NUMBER_PATTERN : undefined}
                          title={isDirNumber ? 'Enter 6 or 11 digits' : undefined}
                          value={sourceCellDraft[key] ?? ''}
                          onChange={(event) => {
                            if (isDirNumber) setSourceDirNumberTouched(true);
                            updateFederalSourceCell(key, isDirNumber ? event.target.value.replace(/\D/g, '').slice(0, 11) : event.target.value);
                          }}
                        />}
                  </div>;
                  })}
                </div>
                : <div className="form-grid">
                  {editableColumns.map((column) => {
                    const initial = request.initialRow[column.name];
                    const isNull = nullFields[column.name] ?? initial === null;
                    const value = draft[column.name] ?? databaseInputValue(initial);
                    const dataType = column.dataType.toLowerCase();
                    const isBit = dataType === 'bit';
                    const isJson = column.name === 'CellsJson';
                    const isDirNumber = /^dirnumber$/i.test(column.name);
                    const isLongText = ['char', 'nchar', 'nvarchar', 'varchar', 'xml'].includes(dataType) && (column.maxLength === -1 || (column.maxLength ?? 0) > 1000);
                    return <div className={`form-field ${isJson ? 'full' : ''}`} key={column.name}>
                      <label htmlFor={`database-edit-${column.name}`}>{column.name} <span className="field-help-inline">({isDirNumber ? '6 or 11 digits · ' : ''}{column.dataType}{column.nullable ? ', nullable' : ''})</span></label>
                      {isNull ? <div className="field-help">This value is NULL.</div>
                        : isBit ? <select id={`database-edit-${column.name}`} className="field" value={value} onChange={(event) => {
                          setDraft((current) => ({ ...current, [column.name]: event.target.value }));
                          setTouched((current) => ({ ...current, [column.name]: true }));
                        }}><option value="">Choose…</option><option value="true">True</option><option value="false">False</option></select>
                        : isJson || isLongText ? <textarea id={`database-edit-${column.name}`} className="field" rows={isJson ? 12 : 5} value={value} onChange={(event) => {
                            setDraft((current) => ({ ...current, [column.name]: event.target.value }));
                            setTouched((current) => ({ ...current, [column.name]: true }));
                          }} />
                             : <input id={`database-edit-${column.name}`} className="field" type="text" inputMode={isDirNumber ? 'numeric' : undefined} maxLength={isDirNumber ? 11 : undefined} pattern={isDirNumber && touched[column.name] ? DIR_NUMBER_PATTERN : undefined} title={isDirNumber ? 'Enter 6 or 11 digits' : undefined} value={value} placeholder={initial === undefined ? 'Value not loaded; enter only to replace' : ''} onChange={(event) => {
                               const nextValue = isDirNumber ? event.target.value.replace(/\D/g, '').slice(0, 11) : event.target.value;
                               setDraft((current) => ({ ...current, [column.name]: nextValue }));
                              setTouched((current) => ({ ...current, [column.name]: true }));
                            }} />}
                      {column.nullable && <label className="checkbox-control" style={{ marginTop: 8 }}>
                        <input type="checkbox" checked={isNull} onChange={(event) => {
                          setNullFields((current) => ({ ...current, [column.name]: event.target.checked }));
                          setTouched((current) => ({ ...current, [column.name]: true }));
                        }} />
                        <span>Set this field to NULL</span>
                      </label>}
                    </div>;
                  })}
                </div>}
        {(validationError || mutation.error) && <div className="alert-message" role="alert">{validationError || 'The update failed. Check the value and retry.'}</div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending || isLoading || !table?.columns.some((column) => column.primaryKey)}>
          {mutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  </div>;
}

function DatabaseExplorerPage() {
  const client = useQueryClient();
  const openDatabaseEditor = useOpenDatabaseEditor();
  const { data: catalog, isLoading, isError, refetch } = useGetDatabaseTables({
    query: { retry: false, staleTime: 60_000 },
  });
  const [selectedKey, setSelectedKey] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [databaseSortBy, setDatabaseSortBy] = useState('databaseOrder');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const tables = catalog?.tables ?? [];
  const defaultTable = tables.find(
    (table) =>
      table.schemaName === 'labor_compliance_excel_stage' &&
      table.tableName === 'Projects',
  ) ?? tables.find((table) => table.recordCount > 0) ?? tables[0];
  const selectedTable = tables.find(
    (table) => `${table.schemaName}.${table.tableName}` === selectedKey,
  ) ?? defaultTable;
  useEffect(() => {
    if (selectedTable && selectedKey !== `${selectedTable.schemaName}.${selectedTable.tableName}`) {
      setSelectedKey(`${selectedTable.schemaName}.${selectedTable.tableName}`);
    }
  }, [selectedTable, selectedKey]);
  const rowsQuery = useQuery({
    queryKey: [
      'database-table-rows',
      selectedTable?.schemaName,
      selectedTable?.tableName,
      page,
      debouncedSearch,
    ],
    queryFn: () =>
      queryDatabaseTableRows(
        selectedTable!.schemaName,
        selectedTable!.tableName,
        { page, pageSize: 50, search: debouncedSearch || undefined },
      ),
    enabled: Boolean(selectedTable),
    staleTime: 30_000,
  });
  const visibleTables = tables.filter((table) =>
    `${table.schemaName} ${table.tableName}`.toLowerCase().includes(tableFilter.trim().toLowerCase()),
  );
  const schemas = [...new Set(visibleTables.map((table) => table.schemaName))];
  const databaseSortOptions: SortOption[] = [
    { value: 'databaseOrder', label: 'Database order' },
    ...(selectedTable?.columns ?? []).map((column, index) => ({
      value: `column${index}:asc`,
      label: `${column.name} A–Z`,
    })),
  ];
  const databaseRows = rowsQuery.data?.rows ?? [];
  const sortedDatabaseRows = sortRows(databaseRows, databaseSortBy, Object.fromEntries(
    (selectedTable?.columns ?? []).map((column, index) => [`column${index}`, (row: Record<string, unknown>) => row[column.name]]),
  ));
  const total = rowsQuery.data?.total ?? selectedTable?.recordCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 50));
  const activePage = Math.min(page, pageCount);
  return <>
    <PageHeader
      eyebrow="SQL Server · Full database access"
      title="SSMS data"
      description="Browse every imported and application table from the SQL Server database, including the original workbook records."
      action={<button className="btn" onClick={() => { void refetch(); void client.invalidateQueries({ queryKey: ['database-table-rows'] }); }} disabled={isLoading}><RefreshCw /> Refresh tables</button>}
    />
    <div className="database-browser">
      <aside className="panel database-browser-picker" aria-label="Database tables">
        <div className="database-browser-picker-head">
          <strong>Tables</strong>
          <span>{tables.length}</span>
        </div>
        <TextFilter value={tableFilter} onChange={setTableFilter} placeholder="Search tables…" />
        {isLoading ? <div className="loading-state">Loading SQL Server tables…</div> : isError ? <ErrorBox retry={() => void refetch()} /> : !visibleTables.length ? <Empty title="No matching tables" detail="Try a different table or schema name." /> :
          schemas.map((schema) => <section className="database-schema-group" key={schema}>
            <h2>{schema}</h2>
            {visibleTables.filter((table) => table.schemaName === schema).map((table) => {
              const key = `${table.schemaName}.${table.tableName}`;
              const active = selectedTable?.schemaName === table.schemaName && selectedTable.tableName === table.tableName;
              return <button
                type="button"
                className={`database-table-choice ${active ? 'active' : ''}`}
                key={key}
                aria-pressed={active}
                 onClick={() => { setSelectedKey(key); setPage(1); setSearch(''); setDebouncedSearch(''); setDatabaseSortBy('databaseOrder'); }}
              >
                <span>{table.tableName}</span><small>{table.recordCount.toLocaleString()}</small>
              </button>;
            })}
          </section>)}
      </aside>
      <section className="panel database-browser-content">
        {selectedTable ? <>
          <div className="database-browser-content-head">
            <div><div className="eyebrow">{selectedTable.schemaName}</div><h2>{selectedTable.tableName}</h2><span>{selectedTable.recordCount.toLocaleString()} records · {selectedTable.columns.length} columns</span></div>
             <TextFilter value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search table rows…" />
             <SortByControl value={databaseSortBy} onChange={setDatabaseSortBy} options={databaseSortOptions} label="Sort current page by" />
          </div>
          {rowsQuery.isError ? <ErrorBox retry={() => void rowsQuery.refetch()} /> : rowsQuery.isLoading && !rowsQuery.data ? <div className="loading-state">Loading table rows…</div> : !rowsQuery.data?.rows.length ? <Empty title="No rows match" detail={debouncedSearch ? "Clear the search to see all rows in this table." : "This SQL Server table is empty."} /> :
            <div className="table-wrap database-rows-wrap">
              <RowNumberedTable className="data-table database-rows-table">
                <thead><tr>{selectedTable.columns.map((column) => <th key={column.name}><span>{column.name}</span><small>{column.dataType}{column.primaryKey ? ' · key' : ''}</small></th>)}<th>Actions</th></tr></thead>
                <tbody>{sortedDatabaseRows.map((row, index) => <tr key={`${selectedTable.schemaName}.${selectedTable.tableName}.${page}.${index}`}>
                  {selectedTable.columns.map((column) => <td key={column.name} title={databaseCell(row[column.name])}>{databaseCell(row[column.name])}</td>)}
                  <td><button type="button" className="table-action" aria-label={`Edit database row ${index + 1}`} title={selectedTable.columns.some((column) => column.primaryKey) ? 'Edit row' : 'This table has no primary key'} disabled={!selectedTable.columns.some((column) => column.primaryKey)} onClick={() => {
                    const key = Object.fromEntries(selectedTable.columns.filter((column) => column.primaryKey).map((column) => [column.name, row[column.name]]));
                    openDatabaseEditor({ schemaName: selectedTable.schemaName, tableName: selectedTable.tableName, key, initialRow: row });
                  }}><SlidersHorizontal /></button></td>
                </tr>)}</tbody>
              </RowNumberedTable>
            </div>}
          <div className="database-pagination">
            <span>{total.toLocaleString()} matching records · Page {activePage} of {pageCount}</span>
            <div><button className="btn" type="button" disabled={activePage <= 1 || rowsQuery.isFetching} onClick={() => setPage(activePage - 1)}>Previous</button>
              <button className="btn" type="button" disabled={activePage >= pageCount || rowsQuery.isFetching} onClick={() => setPage(activePage + 1)}>Next</button></div>
          </div>
        </> : <Empty title="No SQL Server tables" detail="The configured database has no tables available to this dashboard." />}
      </section>
    </div>
  </>;
}

function isSegmentedProjectType(category: string) {
  return Boolean(category && !projectCodeFormats[category]?.singleDigitCount);
}

function parseProjectNumber(value: unknown) {
  const normalized = formatProjectNumberForDisplay(value);
  const segmented = /^(TR|ST|SR|UY|UW|PR)\s*-\s*(\d{2})\s*-\s*(\d{2})$/i.exec(normalized);
  if (segmented) {
    return {
      category: segmented[1].toUpperCase() === 'SR' ? 'ST' : segmented[1].toUpperCase(),
      first: segmented[2],
      second: segmented[3],
      single: '',
    };
  }
  const single = /^(PA|OR)\s*-\s*(\d{7})$/i.exec(normalized);
  return single ? { category: single[1].toUpperCase(), first: '', second: '', single: single[2] } : null;
}

function statusChoice(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['yes', 'registered', 'active', 'complete'].includes(normalized)) return 'Yes';
  if (['no', 'missing', 'inactive', 'incomplete'].includes(normalized)) return 'No';
  return '';
}

function RecordHistoryPanel({ recordType, recordId }: { recordType: 'project' | 'contractor'; recordId: number }) {
  const { data, isLoading, isError } = useGetRecordHistory(recordType, recordId, {
    query: { retry: false, staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 30_000 },
  });
  const formatTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };
  return <section className="record-history" aria-labelledby="record-history-title" data-testid="record-change-history">
    <div className="record-history-heading">
      <div><History aria-hidden="true" /><h3 id="record-history-title">Change history</h3></div>
      <p>Creation and edited values. Imported source rows and subcontractor links are tracked separately.</p>
    </div>
    {isLoading ? <div className="record-history-state">Loading change history…</div>
      : isError ? <div className="record-history-state record-history-error" role="alert">Change history could not be loaded.</div>
        : !data?.length ? <div className="record-history-state">No creation or edits have been recorded for this record.</div>
          : <ol className="record-history-list">{data.map((event) => <li className="record-history-event" key={event.id}>
            <div className="record-history-event-meta">
              <strong>{event.actorId === 'shared-staff-access' ? 'Shared staff access' : `Staff account ${event.actorId}`}</strong>
              <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
            </div>
            <ul className="record-history-changes">{event.changes.map((change, index) => <li key={`${change.field}-${index}`}>
              {change.field === 'Record created'
                ? <span className="record-history-created">{change.after} created</span>
                : <><strong>{change.field}</strong>
                  <span><del>{change.before}</del><span aria-hidden="true"> → </span><ins>{change.after}</ins></span></>}
            </li>)}</ul>
          </li>)}</ol>}
  </section>;
}

function RecordModal({ kind, title, initial, fields, projects, contractors, saving, error, isExistingRecord, notice, onClose, onSubmit, onDelete, onCreatePrimaryContractor }: {
  kind: Kind; title: string; initial: Record<string, any>; fields: FormField[]; projects: Project[]; contractors: Contractor[];
  saving: boolean; error: string; isExistingRecord: boolean; notice?: string; onClose: () => void; onSubmit: (d: Record<string, any>) => void;
  onDelete?: (recordType: TrashRecordType, id: number, title: string) => void;
  onCreatePrimaryContractor: (name: string) => Promise<Contractor>;
}) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const result: Record<string, any> = {};
    fields.forEach(({ key, type }) => {
      let value = initial[key];
      if (key === 'formsStatus') value = value || missingFormsLabel;
      if (type === 'formStatus') value = value || 'Not tracked';
      if (type === 'projectCode') value = initial.projectNumber ?? '';
      if (type === 'lcpStatus') value = statusChoice(initial.registrationStatus);
      if (type === 'dirStatus') value = statusChoice(initial.payrollFormsStatus);
      if (type === 'checkbox') value = value === true;
      result[key] = value ?? '';
    });
    if (kind === 'project') {
      const parsedNumber = parseProjectNumber(initial.projectNumber);
      result.projectCodeType = parsedNumber?.category ?? '';
      result.projectNumberPart1 = parsedNumber?.first ?? '';
      result.projectNumberPart2 = parsedNumber?.second ?? '';
      result.projectNumberSingle = parsedNumber?.single ?? '';
      result.registrationBypass = initial.registrationBypass === true;
      result.registrationBypassStatus = initial.registrationBypassStatus ?? '';
      result.payrollFormsBypass = initial.payrollFormsBypass === true;
      result.payrollFormsBypassStatus = initial.payrollFormsBypassStatus ?? '';
      result.dirNumber = initial.dirNumber ?? '';
      result.registrationCheckedOn = initial.registrationCheckedOn ?? '';
      result.payrollFormsCheckedOn = initial.payrollFormsCheckedOn ?? '';
      result.pwc100RegisteredDate = initial.pwc100RegisteredDate ?? '';
      result.pwc100ExpirationDate = initial.pwc100ExpirationDate ?? '';
      result.pwc100 = initial.pwc100 === true;
      result.federalProject = initial.federalProject === true;
      result.designProject = initial.designProject === true;
      result.onCall = initial.onCall === true;
      result.pasCipDpw = initial.pasCipDpw === true;
    }
    return result;
  });
  const [projectCodeTouched, setProjectCodeTouched] = useState(false);
  const [dirNumberTouched, setDirNumberTouched] = useState(false);
  const [subcontractorSectionOpen, setSubcontractorSectionOpen] = useState(false);
  const [subcontractorEntryMode, setSubcontractorEntryMode] = useState<'existing' | 'new'>('existing');
  const [subcontractorSearch, setSubcontractorSearch] = useState('');
  const [subcontractorValues, setSubcontractorValues] = useState({
    name: '',
    contractorId: '',
    projectId: '',
    projectType: '',
  });
  const matchingSubcontractors = contractors
    .filter((contractor) => `${contractor.name} ${contractor.aliases}`.toLowerCase().includes(subcontractorSearch.trim().toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .slice(0, 100);
  const selectedSubcontractor = contractors.find(
    (contractor) => String(contractor.id) === subcontractorValues.contractorId,
  );
  const subcontractorProjects = projects
    .filter((project) => !isUnnamedProject(project) && project.projectName.trim())
    .sort((left, right) => left.projectName.localeCompare(right.projectName));
  const linkedSubcontractorProject = subcontractorProjects.find(
    (project) => String(project.id) === subcontractorValues.projectId,
  );
  const availableSubcontractorTypes = subContractorProjectTypes(linkedSubcontractorProject);
  const submitValues = () => {
    const submitted = { ...values };
    if (kind === 'contractor' && !isExistingRecord && subcontractorSectionOpen) {
      submitted.subcontractor = {
        ...(subcontractorEntryMode === 'existing'
          ? { contractorId: Number(subcontractorValues.contractorId) }
          : { name: subcontractorValues.name.trim() }),
        projectId: Number(subcontractorValues.projectId),
        projectType: subcontractorValues.projectType,
      };
    } else {
      delete submitted.subcontractor;
    }
    onSubmit(submitted);
  };
  const titleId = `modal-title-${kind}`;
  const projectCodeStarted = Boolean(values.projectCodeType || values.projectNumberPart1 || values.projectNumberPart2 || values.projectNumberSingle);
  const projectCodeRequired = !isExistingRecord || projectCodeStarted;
  const selectedProjectCode = projectCodeFormats[String(values.projectCodeType ?? '')];
  const dirNumberLength = selectedProjectCode?.dirNumberLength;
  const dirNumberRequired = Boolean(
    dirNumberLength
    && (fields.find((field) => field.type === 'dirNumber')?.required ?? true)
    && (!isExistingRecord || projectCodeTouched || dirNumberTouched),
  );
  const segmentedProjectType = isSegmentedProjectType(String(values.projectCodeType ?? ''));
  const legacyProjectNumber = kind === 'project' && initial.projectNumber && !parseProjectNumber(initial.projectNumber);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><form className="modal" onSubmit={e => { e.preventDefault(); submitValues(); }} aria-labelledby={titleId}>
    <div className="modal-head"><div><div className="eyebrow">SQL Server record</div><h2 className="modal-title" id={titleId}>{title}</h2></div><button type="button" className="close-btn" onClick={onClose} aria-label="Close"><X /></button></div>
      <div className="modal-body">{notice && <div className="form-warning" role="note">{notice}</div>}<RequiredFieldsNote /><div className="form-grid">{fields.map(field => {
        const fieldRequired = Boolean(
          field.required
          || ['projectName', 'name', 'amountWithheld'].includes(field.key)
          || (field.type === 'projectCode' && projectCodeRequired)
          || (field.type === 'dirNumber' && dirNumberRequired),
        );
        const bypassKey = field.type === 'lcpStatus' ? 'registrationBypass' : 'payrollFormsBypass';
        const bypassStatusKey = field.type === 'lcpStatus' ? 'registrationBypassStatus' : 'payrollFormsBypassStatus';
        const bypassLabel = field.type === 'lcpStatus' ? 'LCP' : 'DIR';
        return <div className={`form-field ${field.full ? 'full' : ''} ${field.type === 'checkbox' ? 'form-field-checkbox' : ''} ${fieldRequired ? 'required-entry' : ''}`} key={field.key}>
      {field.sectionBefore && <div className="form-section-divider">{field.sectionBefore}</div>}
      {field.type === 'projectFlags' ? <div className="project-flags" role="group" aria-labelledby={`${kind}-project-flags-label`}>
        <div className="form-section-title" id={`${kind}-project-flags-label`}>{field.label}</div>
        <div className="checkbox-group">
          <label className="checkbox-control"><input data-testid="checkbox-project-type-federal" type="checkbox" checked={values.federalProject} onChange={e => setValues({ ...values, federalProject: e.target.checked })} /><span>Federal project</span></label>
          <label className="checkbox-control"><input data-testid="checkbox-project-type-design" type="checkbox" checked={values.designProject} onChange={e => setValues({ ...values, designProject: e.target.checked })} /><span>Design project</span></label>
          <label className="checkbox-control"><input data-testid="checkbox-project-type-on-call" type="checkbox" checked={values.onCall} onChange={e => setValues({ ...values, onCall: e.target.checked })} /><span>On call</span></label>
          <label className="checkbox-control"><input data-testid="checkbox-project-type-pas-cip-dpw" type="checkbox" checked={values.pasCipDpw} onChange={e => setValues({ ...values, pasCipDpw: e.target.checked })} /><span>PAS CIP+DPW</span></label>
        </div>
        <div className="field-help">Select all that apply. The project will appear in every matching section.</div>
      </div>
        : field.type === 'pwc100' ? <div className="pwc100-control">
          <label className="checkbox-control pwc100-toggle" htmlFor={`${kind}-${field.key}`}><input id={`${kind}-${field.key}`} type="checkbox" checked={values.pwc100} onChange={e => setValues({ ...values, pwc100: e.target.checked, ...(!e.target.checked && !field.keepPwcDates ? { pwc100RegisteredDate: '', pwc100ExpirationDate: '' } : {}) })} /><span>{field.label}</span></label>
          {(values.pwc100 || field.keepPwcDates) ? <><div className="field-help pwc100-status-label">Status: {values.pwc100 ? 'Yes' : 'No'}</div><div className="pwc100-date-grid">
            <label className="conditional-date-field" htmlFor={`${kind}-pwc100RegisteredDate`}><span>Enter date registered</span><input className="field" id={`${kind}-pwc100RegisteredDate`} type="date" value={values.pwc100RegisteredDate} onChange={e => setValues({ ...values, pwc100RegisteredDate: e.target.value })} /></label>
            <label className="conditional-date-field" htmlFor={`${kind}-pwc100ExpirationDate`}><span>Enter date expired</span><input className="field" id={`${kind}-pwc100ExpirationDate`} type="date" value={values.pwc100ExpirationDate} onChange={e => setValues({ ...values, pwc100ExpirationDate: e.target.value })} /></label>
          </div></> : <div className="field-help pwc100-status-label">Status: No</div>}
        </div>
        : field.type === 'projectCode' ? <>
          {projectCodeRequired ? <RequiredFieldLabel htmlFor={`${kind}-project-code-type`}>{field.label}</RequiredFieldLabel> : <label htmlFor={`${kind}-project-code-type`}>{field.label}</label>}
          <div className={`project-number-control ${!values.projectCodeType ? 'project-number-control-empty' : segmentedProjectType ? 'project-number-control-segmented' : 'project-number-control-single'}`}>
            <select className="field project-number-type-select" id={`${kind}-project-code-type`} value={values.projectCodeType} required={projectCodeRequired} onChange={e => {
              const category = e.target.value;
              const wasSegmented = isSegmentedProjectType(String(values.projectCodeType ?? ''));
              const isSegmented = isSegmentedProjectType(category);
              const nextFormat = projectCodeFormats[category];
              if (nextFormat && !nextFormat.dirNumberLength && values.dirNumber && !window.confirm('This project type has no DIR# field. Clear the existing DIR# from this project?')) return;
              setProjectCodeTouched(true);
              setValues({
                ...values,
                projectCodeType: category,
                ...(wasSegmented !== isSegmented ? { projectNumberPart1: '', projectNumberPart2: '', projectNumberSingle: '' } : {}),
                ...(nextFormat && !nextFormat.dirNumberLength ? { dirNumber: '' } : {}),
              });
            }}>
              <option value="">Select type</option>{Object.entries(projectCodeFormats).map(([code, format]) => <option key={code} value={code}>{format.label}</option>)}
            </select>
            {segmentedProjectType ? <>
              <span className="project-number-dash" aria-hidden="true">-</span>
              <input className="field project-code-digit project-code-two-digit" type="text" inputMode="numeric" autoComplete="off" maxLength={2} pattern="[0-9]{2}" placeholder="00" aria-label="First two-digit project number segment" required={projectCodeRequired} value={values.projectNumberPart1} onChange={e => { setProjectCodeTouched(true); setValues({ ...values, projectNumberPart1: e.target.value.replace(/\D/g, '').slice(0, 2) }); }} />
              <span className="project-number-dash" aria-hidden="true">-</span>
              <input className="field project-code-digit project-code-two-digit" type="text" inputMode="numeric" autoComplete="off" maxLength={2} pattern="[0-9]{2}" placeholder="00" aria-label="Second two-digit project number segment" required={projectCodeRequired} value={values.projectNumberPart2} onChange={e => { setProjectCodeTouched(true); setValues({ ...values, projectNumberPart2: e.target.value.replace(/\D/g, '').slice(0, 2) }); }} />
            </> : selectedProjectCode?.singleDigitCount ? <>
              <span className="project-number-dash" aria-hidden="true">-</span>
              <input className="field project-code-digit project-code-seven-digit" type="text" inputMode="numeric" autoComplete="off" maxLength={7} pattern="[0-9]{7}" placeholder="0000000" aria-label={`${values.projectCodeType} seven-digit project number`} required={projectCodeRequired} value={values.projectNumberSingle} onChange={e => { setProjectCodeTouched(true); setValues({ ...values, projectNumberSingle: e.target.value.replace(/\D/g, '').slice(0, 7) }); }} />
            </> : null}
          </div>
          {legacyProjectNumber && <div className="field-help">Existing number “{initial.projectNumber}” will be kept unless you enter the new format.</div>}
        </>
        : field.type === 'dirNumberEither' ? <>
          <label htmlFor={`${kind}-${field.key}`}>{field.label} <span className="field-help-inline">(6 or 11 digits)</span></label>
          <input className="field project-dir-number" id={`${kind}-${field.key}`} type="text" inputMode="numeric" autoComplete="off" maxLength={11} pattern={dirNumberTouched ? DIR_NUMBER_PATTERN : undefined} required={field.required} placeholder="6 or 11 digits" value={values[field.key]} onChange={e => { setDirNumberTouched(true); setValues({ ...values, [field.key]: e.target.value.replace(/\D/g, '').slice(0, 11) }); }} />
        </>
        : field.type === 'dirNumber' ? dirNumberLength ? <>
          {dirNumberRequired ? <RequiredFieldLabel htmlFor={`${kind}-dir-number`}>{field.label} <span className="field-help-inline">(6 or 11 digits)</span></RequiredFieldLabel> : <label htmlFor={`${kind}-dir-number`}>{field.label} <span className="field-help-inline">(6 or 11 digits)</span></label>}
          <input className="field project-dir-number" id={`${kind}-dir-number`} type="text" inputMode="numeric" autoComplete="off" maxLength={11} pattern={dirNumberRequired || dirNumberTouched ? DIR_NUMBER_PATTERN : undefined} required={dirNumberRequired} placeholder="6 or 11 digits" value={values.dirNumber} onChange={e => { setDirNumberTouched(true); setValues({ ...values, dirNumber: e.target.value.replace(/\D/g, '').slice(0, 11) }); }} />
        </> : null
        : field.type === 'lcpStatus' || field.type === 'dirStatus' ? <>
          {fieldRequired ? <RequiredFieldLabel htmlFor={`${kind}-${field.key}`}>{field.label}</RequiredFieldLabel> : <label htmlFor={`${kind}-${field.key}`}>{field.label}</label>}
          <div className="project-status-control">
            <select className="field" id={`${kind}-${field.key}`} value={values[field.key]} required={field.required} onChange={e => {
              const dateKey = field.type === 'lcpStatus' ? 'registrationCheckedOn' : 'payrollFormsCheckedOn';
              setValues({ ...values, [field.key]: e.target.value, [dateKey]: e.target.value === 'Yes' || field.keepStatusDate ? values[dateKey] : '' });
            }}><option value="">Select Yes or No</option><option value="Yes">Yes</option><option value="No">No</option></select>
            {(values[field.key] === 'Yes' || field.keepStatusDate) && <label className="conditional-date-field" htmlFor={`${kind}-${field.type === 'lcpStatus' ? 'registrationCheckedOn' : 'payrollFormsCheckedOn'}`}><span>Date</span><input className="field" id={`${kind}-${field.type === 'lcpStatus' ? 'registrationCheckedOn' : 'payrollFormsCheckedOn'}`} type="date" value={values[field.type === 'lcpStatus' ? 'registrationCheckedOn' : 'payrollFormsCheckedOn']} onChange={e => setValues({ ...values, [field.type === 'lcpStatus' ? 'registrationCheckedOn' : 'payrollFormsCheckedOn']: e.target.value })} /></label>}
            <div className="compliance-bypass-control">
              <label className="checkbox-control"><input type="checkbox" aria-label={`${bypassLabel} bypass`} checked={Boolean(values[bypassKey])} onChange={e => setValues({ ...values, [bypassKey]: e.target.checked, ...(!e.target.checked ? { [bypassStatusKey]: '' } : {}) })} /><span>Bypass</span></label>
              {values[bypassKey] && <select className="field" aria-label={`${bypassLabel} bypass status`} required value={values[bypassStatusKey] || ''} onChange={e => setValues({ ...values, [bypassStatusKey]: e.target.value })}>
                <option value="">Select bypass status…</option><option value="OK">OK</option><option value="Completed">Completed</option>
              </select>}
            </div>
            {values[field.key] === 'No' && !values[bypassKey] && <div className="form-warning" role="status">⚠️ {field.type === 'lcpStatus' ? 'LCP registration needs follow-up.' : 'DIR status needs follow-up.'}</div>}
            {values[bypassKey] && <div className="field-help">This status is excluded from Needs Action while bypass is enabled.</div>}
          </div>
        </>
        : <>
          {fieldRequired ? <RequiredFieldLabel htmlFor={`${kind}-${field.key}`}>{field.label}</RequiredFieldLabel> : <label htmlFor={`${kind}-${field.key}`}>{field.label}</label>}
          {field.type === 'textarea' ? <textarea className="field" id={`${kind}-${field.key}`} value={values[field.key]} onChange={e => setValues({ ...values, [field.key]: e.target.value })} />
            : field.options ? <select id={`${kind}-${field.key}`} className="field" required={field.required} value={values[field.key]} onChange={e => setValues({ ...values, [field.key]: e.target.value })}><option value="">Select status…</option>{field.options.map(o => <option key={o}>{o}</option>)}</select>
             : field.type === 'contractor' ? <ContractorSelectWithAdd id={`${kind}-${field.key}`} contractors={contractors} value={String(values[field.key] ?? '')} onChange={(contractorId) => setValues({ ...values, [field.key]: contractorId })} onCreate={onCreatePrimaryContractor} ariaLabel={field.label} />
             : field.type === 'project' || field.type === 'contractor' ? <select id={`${kind}-${field.key}`} className="field" value={values[field.key]} onChange={e => setValues({ ...values, [field.key]: e.target.value })}><option value="">Not linked</option>{(field.type === 'project' ? projects : alphabetizedContractors(contractors)).map((record: any) => <option key={record.id} value={record.id}>{field.type === 'project' ? isUnnamedProject(record) ? `Subs record · ${record.projectNumber || record.projectKey || record.id}` : record.projectName : record.name}</option>)}</select>
                : <input className="field" id={`${kind}-${field.key}`} type={field.type || 'text'} step={field.type === 'number' ? 'any' : undefined} required={field.required || field.key === 'projectName' || field.key === 'name' || field.key === 'amountWithheld'} value={values[field.key]} onChange={e => setValues({ ...values, [field.key]: e.target.value })} />}
        </>}
      </div>;
      })}</div>
      {isExistingRecord && (kind === 'project' || kind === 'contractor') && Number.isInteger(initial.id) && <RecordHistoryPanel recordType={kind} recordId={initial.id} />}
      {kind === 'contractor' && !isExistingRecord && <section className="subcontractor-add-section" data-testid="contractor-subcontractor-section">
        <button type="button" className="btn subcontractor-add-toggle" aria-expanded={subcontractorSectionOpen} onClick={() => setSubcontractorSectionOpen((open) => !open)}>
          {subcontractorSectionOpen ? 'Remove Sub Contractor' : <><Plus /> Add Sub Contractor</>}
        </button>
        {subcontractorSectionOpen && <div className="form-grid subcontractor-add-fields">
          {subcontractorEntryMode === 'existing' ? <>
            <div className="form-field full required-entry">
              <RequiredFieldLabel htmlFor="contractor-subcontractor-existing">Find existing contractor</RequiredFieldLabel>
              <input className="field" id="contractor-subcontractor-search" data-testid="input-subcontractor-search" type="search" value={subcontractorSearch} placeholder="Search contractor names or aliases…" onChange={(event) => {
                setSubcontractorSearch(event.target.value);
                setSubcontractorValues((current) => ({ ...current, contractorId: '' }));
              }} />
              <select className="field subcontractor-existing-select" id="contractor-subcontractor-existing" data-testid="select-existing-subcontractor" value={subcontractorValues.contractorId} required onChange={(event) => setSubcontractorValues((current) => ({ ...current, contractorId: event.target.value }))}>
                <option value="">{matchingSubcontractors.length ? 'Select an existing contractor…' : 'No matching contractors'}</option>
                {matchingSubcontractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.name}{contractor.sourceCount ? ' · source record' : ''}</option>)}
              </select>
              {selectedSubcontractor && <div className="field-help">This links “{selectedSubcontractor.name}” to the selected project without changing its directory record.</div>}
              <button type="button" className="btn subcontractor-entry-switch" onClick={() => {
                setSubcontractorEntryMode('new');
                setSubcontractorValues((current) => ({ ...current, contractorId: '' }));
              }}>Create a new subcontractor instead</button>
            </div>
          </> : <>
            <div className="form-field full required-entry">
              <RequiredFieldLabel htmlFor="contractor-subcontractor-name">New Sub Contractor Name</RequiredFieldLabel>
              <input className="field" id="contractor-subcontractor-name" data-testid="input-subcontractor-name" value={subcontractorValues.name} required onChange={(event) => setSubcontractorValues((current) => ({ ...current, name: event.target.value }))} />
              <button type="button" className="btn subcontractor-entry-switch" onClick={() => {
                setSubcontractorEntryMode('existing');
                setSubcontractorValues((current) => ({ ...current, name: '' }));
              }}>Search existing contractors instead</button>
            </div>
          </>}
          <div className="form-field required-entry">
            <RequiredFieldLabel htmlFor="contractor-subcontractor-project">Project Name</RequiredFieldLabel>
            <select className="field" id="contractor-subcontractor-project" data-testid="select-subcontractor-project" value={subcontractorValues.projectId} required onChange={(event) => {
              const projectId = event.target.value;
              const project = subcontractorProjects.find((candidate) => String(candidate.id) === projectId);
              const types = subContractorProjectTypes(project);
              setSubcontractorValues((current) => ({
                ...current,
                projectId,
                projectType: types.some((type) => type.value === current.projectType)
                  ? current.projectType
                  : types[0]?.value ?? '',
              }));
            }}>
              <option value="">Select project…</option>
              {subcontractorProjects.map((project) => <option key={project.id} value={project.id}>{project.projectName}</option>)}
            </select>
          </div>
          <div className="form-field required-entry">
            <RequiredFieldLabel htmlFor="contractor-subcontractor-type">Project Type</RequiredFieldLabel>
            <select className="field" id="contractor-subcontractor-type" data-testid="select-subcontractor-project-type" value={subcontractorValues.projectType} required disabled={!linkedSubcontractorProject} onChange={(event) => setSubcontractorValues((current) => ({ ...current, projectType: event.target.value }))}>
              <option value="">Select one type…</option>
              {availableSubcontractorTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <div className="field-help">Choose one type for this subcontractor link.</div>
          </div>
          <div className="form-field full">
            <label htmlFor="contractor-subcontractor-project-number">Project Number</label>
            <input className="field" id="contractor-subcontractor-project-number" data-testid="text-subcontractor-project-number" readOnly value={linkedSubcontractorProject ? formatProjectNumberForDisplay(linkedSubcontractorProject.projectNumber || linkedSubcontractorProject.projectKey) : ''} placeholder="Choose a project to see its number" />
          </div>
        </div>}
      </section>}
      {error && <div className="alert-message" role="alert">{error}</div>}</div>
    <div className="modal-foot">
      {isExistingRecord && Number.isInteger(initial.id) && onDelete && <button type="button" className="btn btn-trash" data-testid={`button-delete-${kind}-${initial.id}`} disabled={saving} onClick={() => {
        const recordTitle = kind === 'project'
          ? initial.projectName || `Project ${initial.id}`
          : kind === 'contractor'
            ? initial.name || `Contractor ${initial.id}`
            : initial.invoiceReference || initial.projectName || `Withholding ${initial.id}`;
        onDelete(kind, initial.id, String(recordTitle));
      }}><Trash2 /> Delete</button>}
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : <><Check /> Save record</>}</button>
    </div>
  </form></div>;
}

function referenceValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return 'Not recorded';
  if (typeof value === 'string') return value.length ? value : '(empty)';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function referenceSearchText(record: ReferenceOnlyProject): string {
  return JSON.stringify({
    id: record.id, projectKey: record.projectKey, category: record.category, name: record.name,
    sourceSheet: record.sourceSheet, excelRow: record.excelRow,
    sourceRows: record.sourceRows.map((row) => ({ sourceSheet: row.sourceSheet, excelRow: row.excelRow, cells: row.cells })),
    relatedRecords: record.relatedRecords.map((related) => ({
      tableName: related.tableName, recordId: related.recordId, sourceSheet: related.sourceSheet,
      excelRow: related.excelRow, fields: related.fields,
    })),
  }).toLocaleLowerCase();
}

function ReferenceOnlyPage({ onDelete }: { onDelete: (recordType: TrashRecordType, id: number, title: string) => void }) {
  const { data, isLoading, isError, refetch } = useGetReferenceOnly({
    query: {
      queryKey: getGetReferenceOnlyQueryKey(),
      retry: false,
      staleTime: 60_000,
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
  });
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState('all');
  const [sortBy, setSortBy] = useState('name:asc');
  const records = data?.records ?? [];
  const filteredRecords = sortRows(records.filter((record) =>
    (sheet === 'all' || record.sourceSheet === sheet)
    && (!search.trim() || referenceSearchText(record).includes(search.trim().toLocaleLowerCase())),
  ), sortBy, {
    name: (record) => record.name,
    category: (record) => record.category,
    sourceSheet: (record) => record.sourceSheet,
    excelRow: (record) => record.excelRow ?? Number.MAX_SAFE_INTEGER,
    linkedRecords: (record) => record.relatedRecords.length,
  });
  const summary = data?.summary ?? { totalProjects: 0, sourceRowCount: 0, relatedRecordCount: 0, sourceSheetCounts: [], relatedTableCounts: [] };
  const refreshedLabel = data?.refreshedAt
    ? new Date(data.refreshedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return <div className="reference-only" data-testid="page-reference-only">
    <div className="page-heading reference-heading">
      <div>
        <div className="eyebrow">Workbook provenance · Reference register</div>
        <h1>Reference Only</h1>
        <p className="subheading">Reconcile workbook-only entries with their complete source trail.</p>
      </div>
      {refreshedLabel && <div className="reference-refresh" data-testid="text-reference-refreshed">Updated {refreshedLabel}</div>}
    </div>

    {isLoading && <div className="reference-loading" aria-label="Loading reference records" data-testid="loading-reference-only">
      <div className="reference-skeleton feature" /><div className="reference-skeleton" /><div className="reference-skeleton" />
      <div className="reference-skeleton wide" /><div className="reference-skeleton wide" />
    </div>}
    {isError && !isLoading && <div className="reference-error" role="alert" data-testid="error-reference-only">
      <div><strong>Reference records could not be loaded.</strong><p>Nothing has been filtered or discarded. Retry to retrieve the complete source catalog.</p></div>
      <button type="button" className="btn btn-primary" data-testid="button-retry-reference-only" onClick={() => void refetch()}><RefreshCw /> Retry</button>
    </div>}

    {data && <>
      <div className="reference-summary" data-testid="summary-reference-only">
        <div className="reference-total">
          <span className="reference-label">Reference entries</span>
          <strong data-testid="text-reference-total">{summary.totalProjects}</strong>
          <span>cataloged projects</span>
        </div>
        <div className="reference-summary-side">
          <div className="reference-stat"><span>Source snapshots</span><strong data-testid="text-reference-source-count">{summary.sourceRowCount}</strong><small>unique workbook rows</small></div>
          <div className="reference-stat"><span>Linked records</span><strong data-testid="text-reference-related-count">{summary.relatedRecordCount}</strong><small>across source tables</small></div>
        </div>
        <div className="reference-sheet-summary">
          <div className="reference-label">Source sheets</div>
          {summary.sourceSheetCounts.map((item) => <div className="reference-count-line" key={item.name} data-testid={`text-reference-sheet-count-${item.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>
            <span>{item.name}</span><strong>{item.count}</strong>
          </div>)}
        </div>
      </div>

      <section className="reference-tables panel" aria-label="Related record table counts">
        <div className="reference-table-intro"><div><span className="reference-label">Source trail coverage</span><strong>Related SQL records</strong></div><span>{summary.relatedTableCounts.length} tables</span></div>
        <div className="reference-table-counts">
          {summary.relatedTableCounts.map((item) => <div key={item.name} className="reference-table-count" data-testid={`text-reference-table-count-${item.name}`}>
            <span>{item.name}</span><strong>{item.count}</strong>
          </div>)}
        </div>
      </section>

      <section className="reference-browser" aria-label="Reference entry browser">
        <div className="reference-browser-head">
          <div><div className="reference-label">Complete register</div><h2>Workbook references</h2></div>
          <span className="reference-result-count" data-testid="text-reference-result-count">{filteredRecords.length} of {records.length} entries</span>
        </div>
        <div className="reference-controls">
          <label className="reference-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Search references and source data</span>
            <input className="field" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, cells, source fields, linked records…" data-testid="input-reference-search" />
          </label>
          <label className="reference-filter">
            <span>Source sheet</span>
            <select className="field" value={sheet} onChange={(event) => setSheet(event.target.value)} data-testid="select-reference-sheet">
              <option value="all">All source sheets</option>
              {(summary.sourceSheetCounts || []).map(({ name }) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
          <SortByControl value={sortBy} onChange={setSortBy} options={[
            { value: 'name:asc', label: 'Project name A–Z' },
            { value: 'name:desc', label: 'Project name Z–A' },
            { value: 'category:asc', label: 'Category A–Z' },
            { value: 'sourceSheet:asc', label: 'Source sheet A–Z' },
            { value: 'excelRow:asc', label: 'Excel row' },
            { value: 'linkedRecords:desc', label: 'Most linked records' },
          ]} />
          {(search || sheet !== 'all') && <button type="button" className="btn reference-clear" onClick={() => { setSearch(''); setSheet('all'); }} data-testid="button-clear-reference-filters">Clear filters</button>}
        </div>
        {!records.length && <div className="reference-empty" data-testid="empty-reference-catalog">
          <div className="reference-empty-index">No entries</div><strong>The reference catalog is empty.</strong><p>When reference-only records are available, their source trails will appear here.</p>
        </div>}
        {!!records.length && !filteredRecords.length && <div className="reference-empty" data-testid="empty-reference-results">
          <div className="reference-empty-index">No matches</div><strong>No references match these filters.</strong><p>Try a different search term or choose another source sheet.</p>
        </div>}
        <div className="reference-record-list">
          {filteredRecords.map((record) => <ReferenceRecord key={record.id} record={record} onDelete={onDelete} />)}
        </div>
      </section>
    </>}
  </div>;
}

function ReferenceRecord({ record, onDelete }: { record: ReferenceOnlyProject; onDelete: (recordType: TrashRecordType, id: number, title: string) => void }) {
  const openDatabaseEditor = useOpenDatabaseEditor();
  return <details className="reference-record" data-testid={`record-reference-${record.id}`}>
    <summary className="reference-record-summary">
      <span className="reference-record-marker" aria-hidden="true" />
      <span className="reference-record-main">
        <span className="reference-record-title">{record.name || 'Unnamed reference'}</span>
        <span className="reference-record-meta"><span>{record.category}</span><span>{record.sourceSheet}</span><span>Workbook row {record.excelRow ?? 'not assigned'}</span></span>
      </span>
      <span className="reference-record-key">{record.projectKey || `Record ${record.id}`}</span>
      <span className="reference-record-trail">{record.sourceRows.length} snapshots <i /> {record.relatedRecords.length} linked</span>
      <ChevronDown className="reference-record-caret" aria-hidden="true" />
    </summary>
    <div className="reference-record-detail">
      <div className="reference-identity">
        <div><span>Record ID</span><strong>{record.id}</strong></div>
        <div><span>Project key</span><strong>{referenceValue(record.projectKey)}</strong></div>
        <div><span>Category</span><strong>{referenceValue(record.category)}</strong></div>
        <div><span>Primary sheet</span><strong>{referenceValue(record.sourceSheet)}</strong></div>
        <div><span>Primary Excel row</span><strong>{referenceValue(record.excelRow)}</strong></div>
        <button type="button" className="btn" onClick={() => openDatabaseEditor({
          schemaName: 'labor_compliance_excel_stage',
          tableName: 'Projects',
          key: { Id: record.id },
          initialRow: { ProjectKey: record.projectKey, Category: record.category, Name: record.name },
        })}><SlidersHorizontal /> Edit project record</button>
        <DeleteAction recordType="project" id={record.id} title={record.name || `Reference project ${record.id}`} onDelete={onDelete} />
      </div>
      <section className="reference-detail-section">
        <div className="reference-section-title"><div><span className="reference-label">Workbook evidence</span><h3>Source snapshots</h3></div><span>{record.sourceRows.length} rows</span></div>
        {record.sourceRows.map((row) => <ReferenceSourceSnapshot key={`${row.id}-${row.sourceSheet}-${row.excelRow}`} row={row} onDelete={onDelete} />)}
        {!record.sourceRows.length && <p className="reference-no-data">No source snapshots are linked to this entry.</p>}
      </section>
      <section className="reference-detail-section">
        <div className="reference-section-title"><div><span className="reference-label">Database evidence</span><h3>Related records</h3></div><span>{record.relatedRecords.length} records</span></div>
        <div className="reference-related-list">
          {record.relatedRecords.map((related, index) => <ReferenceRelated key={`${related.tableName}-${related.recordId}-${index}`} related={related} index={index} projectId={record.id} />)}
        </div>
        {!record.relatedRecords.length && <p className="reference-no-data">No related database records are linked to this entry.</p>}
      </section>
    </div>
  </details>;
}

function ReferenceSourceSnapshot({ row, onDelete }: { row: ReferenceOnlySourceRow; onDelete: (recordType: TrashRecordType, id: number, title: string) => void }) {
  const openDatabaseEditor = useOpenDatabaseEditor();
  return <details className="reference-evidence" data-testid={`source-snapshot-${row.id}`}>
    <summary><span className="reference-sheet-tag">{row.sourceSheet}</span><strong>Excel row {row.excelRow}</strong><span>{Object.keys(row.cells).length} populated cells</span><ChevronDown aria-hidden="true" /></summary>
    <div className="reference-field-grid">
      <button type="button" className="btn" onClick={() => openDatabaseEditor({
        schemaName: 'labor_compliance_excel_stage',
        tableName: 'SourceRows',
        key: { Id: row.id },
        initialRow: { Id: row.id, ExcelRow: row.excelRow, CellsJson: JSON.stringify(row.cells, null, 2) },
      })}><SlidersHorizontal /> Edit source row</button>
      {Object.entries(row.cells).map(([coordinate, value]) => <div className="reference-field-pair" key={coordinate} data-testid={`source-cell-${row.id}-${coordinate}`}>
        <span>{coordinate}</span><pre>{referenceValue(value)}</pre>
      </div>)}
    </div>
      <DeleteAction recordType="sourceRow" id={row.id} title={`${row.sourceSheet} row ${row.excelRow}`} onDelete={onDelete} />
    {!Object.keys(row.cells).length && <p className="reference-no-data">This source row contains no populated cell values.</p>}
  </details>;
}

function ReferenceRelated({ related, index, projectId }: { related: ReferenceOnlyRelatedRecord; index: number; projectId: number }) {
  const openDatabaseEditor = useOpenDatabaseEditor();
  return <details className="reference-evidence reference-related" data-testid={`related-record-${projectId}-${index}`}>
    <summary><span className="reference-table-tag">{related.tableName}</span><strong>Record {related.recordId}</strong><span>{related.sourceSheet ? `${related.sourceSheet} · row ${related.excelRow ?? 'not assigned'}` : 'No workbook row linked'}</span><ChevronDown aria-hidden="true" /></summary>
    <div className="reference-field-grid">
      <button type="button" className="btn" onClick={() => openDatabaseEditor({
        schemaName: 'labor_compliance_excel_stage',
        tableName: related.tableName,
        key: { Id: related.recordId },
        initialRow: related.fields,
      })}><SlidersHorizontal /> Edit linked record</button>
      {Object.entries(related.fields).map(([field, value]) => <div className="reference-field-pair" key={field} data-testid={`related-field-${projectId}-${index}-${field}`}>
        <span>{field}</span><pre>{referenceValue(value)}</pre>
      </div>)}
    </div>
    {!Object.keys(related.fields).length && <p className="reference-no-data">This related record has no field values.</p>}
  </details>;
}

function AuthenticatedWorkspace() {
  const client = useQueryClient();
  const { data: workspace, isLoading, isError, error: workspaceError, refetch } = useGetWorkspace({ query: { refetchInterval: 60_000, retry: false, refetchOnWindowFocus: true } });
  const health = useHealthCheck({ query: { refetchInterval: 60_000 } });
  const addProject = useCreateProject(); const editProject = useUpdateProject();
  const addContractor = useCreateContractor(); const editContractor = useUpdateContractor();
  const addWithholding = useCreateWithholding(); const editWithholding = useUpdateWithholding();
  const moveToTrash = useMoveRecordToTrash();
  const [modal, setModal] = useState<{
    kind: Kind;
    record?: any;
    initial?: Record<string, unknown>;
    useEditFields?: boolean;
    notice?: string;
  } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ recordType: TrashRecordType; id: number; title: string } | null>(null);
  const [databaseEditRequest, setDatabaseEditRequest] = useState<DatabaseEditRequest | null>(null);
  const [location] = useLocation();
  const selectedSheet = workbookSheetTabs.find((tab) => tab.href === location);
  const isActiveFederalPage = location === '/sheets/active-federal-projects';
  const getModalFields = (kind: Kind, isExistingRecord: boolean): FormField[] => {
    if (kind === 'project') {
      if (isExistingRecord) return projectFields;
      const modalOnCallProject = Boolean(modal?.record?.onCall || modal?.initial?.onCall);
      if (isActiveFederalPage) {
        return activeFederalProjectAddFields;
      }
      if (modalOnCallProject) {
        return onCallProjectEntryFields;
      }
      return projectEntryFields;
    }
    return kind === 'contractor' ? isExistingRecord ? contractorEditFields : contractorAddFields : withholdingFields;
  };
  const projects = workspace?.projects || []; const contractors = workspace?.contractors || []; const withholdings = workspace?.withholdings || [];
  const invalidate = () => { void client.invalidateQueries(); };
  const deleteRecord = (recordType: TrashRecordType, id: number, title: string) => {
    if (moveToTrash.isPending || deleteConfirmation) return;
    moveToTrash.reset();
    setDeleteConfirmation({ recordType, id, title });
  };
  const confirmDeleteRecord = () => {
    if (!deleteConfirmation || moveToTrash.isPending) return;
    const { recordType, id } = deleteConfirmation;
    moveToTrash.mutate({ recordType, recordId: id }, {
      onSuccess: () => {
        invalidate();
        setModal(null);
        setDeleteConfirmation(null);
      },
    });
  };
  const cancelDeleteRecord = () => {
    if (moveToTrash.isPending) return;
    setDeleteConfirmation(null);
    moveToTrash.reset();
  };
  const saveRecord = (values: Record<string, any>) => {
    if (!modal) return;
    const { kind, record } = modal;
    const fields = getModalFields(kind, Boolean(record || modal.useEditFields));
    const data = coerceFields(values, fields);
    if (kind === 'project') {
      data.registrationBypass = values.registrationBypass === true;
      data.registrationBypassStatus = values.registrationBypass ? values.registrationBypassStatus : '';
      data.payrollFormsBypass = values.payrollFormsBypass === true;
      data.payrollFormsBypassStatus = values.payrollFormsBypass ? values.payrollFormsBypassStatus : '';
    }
    if (kind === 'contractor' && values.subcontractor) {
      data.subcontractor = values.subcontractor;
    }
    if (kind === 'project' && isActiveFederalPage) {
      if (!record) data.federalProject = true;
      if (record) {
        for (const key of activeFederalAppFieldKeys) {
          if (String(data[key] ?? '') === String(record[key] ?? '')) delete data[key];
        }
      }
    }
    const done = () => { invalidate(); setModal(null); };
    if (kind === 'project') record ? editProject.mutate({ id: record.id, data: data as ProjectUpdate }, { onSuccess: done }) : addProject.mutate({ data: data as ProjectInput }, { onSuccess: done });
    if (kind === 'contractor') record ? editContractor.mutate({ id: record.id, data: data as ContractorUpdate }, { onSuccess: done }) : addContractor.mutate({ data: data as ContractorInput }, { onSuccess: done });
    if (kind === 'withholding') record ? editWithholding.mutate({ id: record.id, data: data as WithholdingUpdate }, { onSuccess: done }) : addWithholding.mutate({ data: data as WithholdingInput }, { onSuccess: done });
  };
  const createPrimaryContractor = async (name: string): Promise<Contractor> => {
    const contractor = await addContractor.mutateAsync({ data: { name } });
    await client.invalidateQueries();
    return contractor;
  };
  const saving = addProject.isPending || editProject.isPending || addContractor.isPending || editContractor.isPending || addWithholding.isPending || editWithholding.isPending;
  const mutationError = addProject.error || editProject.error || addContractor.error || editContractor.error || addWithholding.error || editWithholding.error;
  const deleteError = moveToTrash.error instanceof Error ? moveToTrash.error.message : '';
  const recordError = deleteError || (mutationError instanceof Error && mutationError.message.includes('Run the contractor-subcontractor SQL migration')
    ? 'Run artifacts/api-server/migrations/add-contractor-subcontractor-links.sql in the MIS119ATEMP database before creating or maintaining subcontractor links.'
    : mutationError instanceof Error && mutationError.message.includes('Prime Approver')
      ? 'Run artifacts/api-server/migrations/add-project-prime-approver.sql in the dashboard database to save Prime Approver.'
       : mutationError instanceof Error && mutationError.message.toLowerCase().includes('bypass')
         ? 'Run artifacts/api-server/migrations/add-lcp-dir-bypass-fields.sql in the MIS119ATEMP database to save LCP and DIR bypass settings.'
      : mutationError instanceof Error && mutationError.message.includes('Design project details')
        ? 'These fields need the SQL migration in artifacts/api-server/migrations/add-complete-project-edit-fields.sql to be run by a database administrator.'
        : mutationError instanceof Error && (
          mutationError.message.includes('Individual Form 1–4 statuses') ||
          mutationError.message.includes('Active Federal fields')
        )
          ? 'These fields need the SQL migration in artifacts/api-server/migrations/add-project-form-statuses.sql to be run by a database administrator.'
          : mutationError ? 'Unable to save this record. Please check the fields and retry.' : '');
  const headerAction = (kind: Kind, initial?: Record<string, unknown>) => setModal({ kind, initial });
  const createProjectFromFederalSource = (initial: Record<string, unknown>) => setModal({
    kind: 'project',
    initial,
    useEditFields: true,
    notice: 'Saving creates a linked SQL project record. The imported worksheet row remains unchanged.',
  });
  const saveDesignProject = (id: number, data: ProjectUpdate) => editProject.mutateAsync({ id, data }).then(() => { invalidate(); });
  const quotaMessage = workspaceQuotaMessage(workspaceError);
  const modalUsesEditFields = Boolean(modal?.record || modal?.useEditFields);
  return <WorkspaceErrorMessageContext.Provider value={quotaMessage}><DatabaseEditorContext.Provider value={(request) => setDatabaseEditRequest(request)}><Shell>
    {workspace && quotaMessage && <div className="error-state" role="alert">{quotaMessage} Previously loaded records are shown below.</div>}
    {deleteError && !modal && <div className="error-state" role="alert"><strong>Could not move the record to Trash.</strong><span>{deleteError}</span></div>}
    {location === '/dashboard' && <Dashboard workspace={workspace} loading={isLoading} error={isError} retry={() => void refetch()} onAdd={headerAction} onEdit={(kind: Kind, record: any) => setModal({ kind, record })} onDelete={deleteRecord} />}
    {location === '/restitutions' && <RestitutionsPage projects={projects} contractors={contractors} onDelete={(id, title) => deleteRecord('restitution', id, title)} onCreatePrimaryContractor={createPrimaryContractor} />}
    {location === '/trash' && <TrashPage />}
    {location === '/projects' && <ProjectsPage projects={projects} contractors={contractors} loading={isLoading} error={isError} retry={() => void refetch()} onAdd={headerAction} onEdit={(kind: Kind, record: any) => setModal({ kind, record })} onCreateFromSource={createProjectFromFederalSource} onDelete={deleteRecord} allProjectsPage />}
    {location === '/contractors' && <ContractorsPage contractors={contractors} projects={projects} loading={isLoading} error={isError} retry={() => void refetch()} onAdd={headerAction} onEdit={(kind: Kind, record: any) => setModal({ kind, record })} onLinksChanged={invalidate} onDelete={deleteRecord} />}
    {location === '/withholdings' && <WithholdingsPage withholdings={withholdings} loading={isLoading} error={isError} retry={() => void refetch()} onAdd={headerAction} onEdit={(kind: Kind, record: any) => setModal({ kind, record })} onDelete={deleteRecord} />}
    {location === '/database' && <DatabaseExplorerPage />}
    {location === '/reference-only' && <ReferenceOnlyPage onDelete={deleteRecord} />}
    {selectedSheet?.view === 'projects' && selectedSheet.href === '/sheets/pas-cip-dpw' && <PasCipDpwPage projects={projects} loading={isLoading} error={isError} retry={() => void refetch()} onAdd={headerAction} onEdit={(kind: Kind, record: Project) => setModal({ kind, record })} onDelete={deleteRecord} />}
    {selectedSheet?.view === 'projects' && selectedSheet.href !== '/sheets/pas-cip-dpw' && <ProjectsPage projects={projects} contractors={contractors} loading={isLoading} error={isError} retry={() => void refetch()} onAdd={headerAction} onEdit={(kind: Kind, record: any) => setModal({ kind, record })} onCreateFromSource={createProjectFromFederalSource} onDelete={deleteRecord} sourceSheet={selectedSheet.label} />}
    {selectedSheet?.view === 'withholdings' && <WithholdingsPage withholdings={withholdings} loading={isLoading} error={isError} retry={() => void refetch()} onAdd={headerAction} onEdit={(kind: Kind, record: any) => setModal({ kind, record })} onDelete={deleteRecord} />}
    {selectedSheet?.view === 'source' && <SourceSheetPage sheetName={selectedSheet.label} onDelete={deleteRecord} />}
    {!['/dashboard', '/projects', '/contractors', '/withholdings', '/restitutions', '/database', '/reference-only'].includes(location) && !selectedSheet && <Redirect to="/dashboard" />}
    {modal && <RecordModal key={`${modal.kind}-${modal.record?.id ?? 'new'}`} kind={modal.kind} title={modalUsesEditFields ? `Edit ${modal.kind}` : `Add ${modal.kind}`} initial={modal.record || modal.initial || {}} fields={getModalFields(modal.kind, modalUsesEditFields)} projects={projects} contractors={contractors} saving={saving || moveToTrash.isPending} error={recordError} isExistingRecord={modalUsesEditFields} notice={modal.notice} onClose={() => { moveToTrash.reset(); setModal(null); }} onSubmit={saveRecord} onDelete={deleteRecord} onCreatePrimaryContractor={createPrimaryContractor} />}
    {deleteConfirmation && <ConfirmDeleteDialog recordTitle={deleteConfirmation.title} pending={moveToTrash.isPending} error={deleteError} onCancel={cancelDeleteRecord} onConfirm={confirmDeleteRecord} />}
    {databaseEditRequest && <DatabaseRowEditDialog key={`${databaseEditRequest.schemaName}.${databaseEditRequest.tableName}.${JSON.stringify(databaseEditRequest.key)}`} request={databaseEditRequest} onClose={() => setDatabaseEditRequest(null)} />}
    <span hidden>{health.data?.status}</span>
  </Shell></DatabaseEditorContext.Provider></WorkspaceErrorMessageContext.Provider>;
}
function ProtectedWorkspace() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="app-frame"><div className="workspace"><div className="content"><div className="panel loading-state">Loading secure workspace…</div></div></div></div>;
  return isSignedIn ? <AuthenticatedWorkspace /> : <Redirect to="/" />;
}
function ClerkQueryCacheInvalidator() {
  const { addListener } = useClerk(); const queryClient = useQueryClient();
  useEffect(() => { let prior: string | null | undefined; const unsubscribe = addListener(({ user }) => { const next = user?.id ?? null; if (prior !== undefined && prior !== next) queryClient.clear(); prior = next; }); return unsubscribe; }, [addListener, queryClient]);
  return null;
}
function PublicRoutes() {
  return <QueryClientProvider client={queryClient}><Switch>
    <Route path="/" component={() => <Redirect to="/dashboard" />} />
    <Route path="/sign-in/*?" component={() => <Redirect to="/dashboard" />} />
    <Route path="/sign-up/*?" component={() => <Redirect to="/dashboard" />} />
    <Route path="/request-access" component={() => <Redirect to="/dashboard" />} />
    <Route path="/dashboard" component={AuthenticatedWorkspace} />
    <Route path="/projects" component={AuthenticatedWorkspace} />
    <Route path="/contractors" component={AuthenticatedWorkspace} />
    <Route path="/withholdings" component={AuthenticatedWorkspace} />
    <Route path="/restitutions" component={AuthenticatedWorkspace} />
    <Route path="/trash" component={AuthenticatedWorkspace} />
    <Route path="/database" component={AuthenticatedWorkspace} />
    <Route path="/reference-only" component={AuthenticatedWorkspace} />
    <Route path="/sheets/:sheetSlug" component={AuthenticatedWorkspace} />
    <Route component={() => <div className="landing" style={{ padding: 40 }}><Link className="btn" href="/dashboard"><ArrowLeft /> Return to overview</Link><h1 style={{ marginTop: 40 }}>This page is not in the record.</h1></div>} />
  </Switch></QueryClientProvider>;
}
function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access the Sunnyvale staff workspace' } }, signUp: { start: { title: 'Invitation required', subtitle: 'Create your account from your staff invitation' } } }}
    routerPush={(to: string) => setLocation(stripBase(to))} routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkQueryCacheInvalidator /><Switch>
      <Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/request-access" component={RequestAccessPage} />
      <Route path="/dashboard" component={ProtectedWorkspace} /><Route path="/projects" component={ProtectedWorkspace} /><Route path="/contractors" component={ProtectedWorkspace} /><Route path="/withholdings" component={ProtectedWorkspace} /><Route path="/restitutions" component={ProtectedWorkspace} /><Route path="/trash" component={ProtectedWorkspace} /><Route path="/database" component={ProtectedWorkspace} /><Route path="/reference-only" component={ProtectedWorkspace} /><Route path="/sheets/:sheetSlug" component={ProtectedWorkspace} />
      <Route component={() => <div className="landing" style={{ padding: 40 }}><Link className="btn" href="/dashboard"><ArrowLeft /> Return to overview</Link><h1 style={{ marginTop: 40 }}>This page is not in the record.</h1></div>} />
    </Switch></QueryClientProvider>
  </ClerkProvider>;
}
function App() { return <WouterRouter base={basePath}>{isPublishedPublicMode ? <PublicRoutes /> : <ClerkRoutes />}</WouterRouter>; }
export default App;
