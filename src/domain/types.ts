import type { ISODate, MonthKey } from './dates';
import type { Paise } from './money';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'wealth-os';

export type Id = string;
export type Timestamp = string; // ISO date-time
export type PersonId = 'p1' | 'p2';
/** `hh` = joint / shared. Stored on records; household VIEW aggregates everything. */
export type OwnerId = PersonId | 'hh';
export type ViewScope = 'household' | PersonId;

export interface Stamped { id: Id; createdAt: Timestamp; updatedAt: Timestamp }

// ---------- people & settings
export interface Person { id: PersonId; name: string; savingsTarget: Paise }
export interface Settings extends Stamped {
  people: Person[];
  householdName: string;
  householdSavingsTarget: Paise;      // ideal (₹60k)
  householdSavingsMinimum: Paise;     // acceptable floor (₹50k)
  transportReviewThreshold: Paise;    // configurable review threshold, not a rule
  spikeFactor: number;                // ×trailing average counted as unusual
  spikeMinimum: Paise;                // ignore spikes smaller than this absolute rise
  homeCookSavingsPct: number;         // ASSUMPTION used for delivery estimate (0-100)
  localMarketSavingsPct: number;      // ASSUMPTION used for grocery opportunity (0-100)
  subscriptionReviewDays: number;     // flag "worth a check" if not marked used for this long
  incomeTypes: string[];              // Salary, Bonus … + user-added custom types
  lastBackupAt?: Timestamp;
  lockEnabled: boolean;
  monthNotes: Record<MonthKey, string>; // context e.g. "Durga Puja"
  defaults: { accountId?: Id; paymentMethod?: PaymentMethod; ownerId?: OwnerId };
}

// ---------- categories
export interface Category extends Stamped {
  name: string;
  parentId?: Id;
  kind: 'expense' | 'income';
  system?: string; // stable key used by insights, e.g. 'groceries'
}

// ---------- accounts
export type AccountKind = 'bank' | 'cash' | 'wallet' | 'credit_card' | 'investment';
export interface Account extends Stamped {
  name: string;
  kind: AccountKind;
  ownerId: OwnerId;
  openingBalance: Paise; // signed; for credit_card use NEGATIVE of outstanding (or enter outstanding via UI helper)
  openingDate: ISODate;
  archived?: boolean;
  notes?: string;
  card?: CardDetails;
}
export interface CardDetails {
  creditLimit: Paise;
  statementDay?: number; // 1-31
  dueDay?: number;
  last4?: string;        // optional, 4 digits only. Never full number.
  /** true/undefined: tracked balance already includes remaining EMI principal. false: it excludes it (bank 'outstanding excl. EMI'). */
  emiInLedger?: boolean;
  rewards?: RewardConfig;
}
/** User-maintained; NO defaults are shipped (rules change; unverifiable offline). */
export interface RewardConfig {
  pointsPerBlock: number; blockAmount: Paise; pointValue: Paise; excludedCategoryIds: Id[];
  note?: string; asOf?: ISODate; source?: string;
}
export type PaymentMethod = 'upi' | 'credit_card' | 'debit_card' | 'cash' | 'bank_transfer' | 'other';

/** Bank-reported card values (history retained). Takes precedence over estimates. */
export interface CardReport extends Stamped {
  accountId: Id;
  date: ISODate;
  source: 'statement' | 'app' | 'sms' | 'manual';
  creditLimit?: Paise;
  availableLimit?: Paise;
  outstanding?: Paise;
  nonEmiOutstanding?: Paise;
  emiOutstanding?: Paise;
  emiBlocked?: Paise;
  notes?: string;
}

// ---------- transactions
export type TxnType =
  | 'income' | 'expense' | 'refund' | 'transfer' | 'cc_settlement'
  | 'investment_contribution' | 'investment_redemption' | 'asset_acquisition'
  | 'liability_creation' | 'liability_payment' | 'adjustment';

export interface Transaction extends Stamped {
  type: TxnType;
  date: ISODate;
  amount: Paise;            // >0 (adjustment: signed, non-zero)
  ownerId: OwnerId;         // who spent / earned / owns the event
  fromAccountId?: Id;       // funding account
  toAccountId?: Id;         // receiving account
  paymentMethod?: PaymentMethod;
  categoryId?: Id;
  subcategoryId?: Id;
  merchant?: string;
  incomeType?: string;      // for income: Salary, Bonus, ... or custom
  tags?: string[];
  notes?: string;
  recurring?: boolean;      // expected/regular classification
  oneOff?: boolean;         // unusual/one-off: excluded from run-rate baselines
  investmentId?: Id;        // contribution / redemption target
  assetId?: Id;             // asset_acquisition target
  liabilityId?: Id;         // liability_creation / payment
  principalPortion?: Paise; // liability_payment; interest = amount - principal
  refundOfId?: Id;
  expectedItemId?: Id;      // set when confirmed from an expected item
  expectedDate?: ISODate;   // occurrence date it satisfies
}

// ---------- investments / assets (manual valuation)
export type InvestmentType = 'mutual_fund' | 'stock' | 'fd' | 'rd' | 'sip' | 'ppf_epf' | 'other';
export interface Investment extends Stamped {
  name: string; type: InvestmentType; institution?: string; ownerId: OwnerId; notes?: string; archived?: boolean;
}
export type AssetKind = 'gold' | 'property' | 'vehicle' | 'other';
export interface Asset extends Stamped {
  name: string; kind: AssetKind; ownerId: OwnerId; notes?: string; archived?: boolean;
}
export interface Valuation extends Stamped {
  targetType: 'investment' | 'asset';
  targetId: Id;
  date: ISODate;
  value: Paise;
  invested?: Paise; // cost basis as of date (investments)
}

// ---------- liabilities, EMIs
export type LiabilityType = 'education' | 'appliance' | 'personal' | 'home' | 'vehicle' | 'other';
export interface Liability extends Stamped {
  name: string; type: LiabilityType; ownerId: OwnerId;
  originalPrincipal: Paise;
  baselineOutstanding: Paise; // outstanding as of baselineDate
  baselineDate: ISODate;
  emi: Paise;                 // monthly commitment (0 if none)
  interestRate: number;       // % p.a., 0 = zero-interest
  startDate: ISODate;
  endDate?: ISODate;
  paymentDay?: number;
  status: 'active' | 'closed';
  notes?: string;
}

export type BlockPolicy = 'as_paid' | 'on_completion';
export interface Emi extends Stamped {
  name: string;
  cardAccountId: Id;
  ownerId: OwnerId;
  originalAmount: Paise;
  emiAmount: Paise;
  tenure: number;               // total months
  startDate: ISODate;
  paymentDay?: number;
  monthsCompletedAtEntry: number; // 0 for a new EMI
  outstandingAtEntry: Paise;      // principal remaining when entered
  payments: EmiPayment[];         // confirmed instalments
  blockPolicy: BlockPolicy;
  blockedOverride?: Paise;        // manual blocked amount (estimate replacement)
  purchaseTxnId?: Id;             // original expense, if recorded (informational link)
  status: 'active' | 'completed' | 'stopped';
  notes?: string;
}
export interface EmiPayment { id: Id; date: ISODate; dueDate: ISODate; principal: Paise; amount: Paise }

// ---------- expected / recurring
export type ExpectedKind = 'subscription' | 'sip' | 'salary' | 'bill' | 'other';
export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export interface ExpectedItem extends Stamped {
  kind: ExpectedKind;
  name: string;
  amount: Paise;
  frequency: Frequency;
  startDate: ISODate;       // first occurrence / anchor
  endDate?: ISODate;        // set by "stop"
  ownerId: OwnerId;
  accountId?: Id;           // funding (expense/sip) or receiving (salary)
  paymentMethod?: PaymentMethod;
  categoryId?: Id;
  merchant?: string;
  investmentId?: Id;        // sip
  incomeType?: string;      // salary
  skipped: ISODate[];       // skipped occurrence dates
  confirmed: Record<ISODate, Id>; // occurrence date -> transaction id
  lastUsed?: ISODate;       // subscriptions: when user last said they used it
  status: 'active' | 'stopped';
  notes?: string;
}

// ---------- goals
export type GoalKind = 'emergency' | 'trip' | 'land' | 'purchase' | 'vehicle' | 'home' | 'wealth' | 'other';
export interface Goal extends Stamped {
  name: string; kind: GoalKind; ownerId: OwnerId; // hh = household goal
  targetAmount: Paise; targetDate?: ISODate; location?: string; description?: string;
  status: 'active' | 'achieved' | 'paused';
}
/** Conceptual envelope movement. NEVER touches balances. Signed (negative = release). */
export interface GoalAllocation extends Stamped { goalId: Id; date: ISODate; amount: Paise; ownerId: OwnerId; notes?: string }

// ---------- waste
export type WasteCategory = 'food' | 'groceries' | 'product' | 'unused' | 'spoiled' | 'other';
export interface WasteEntry extends Stamped {
  date: ISODate; item: string; quantity?: string; cost: Paise; category: WasteCategory;
  reason?: string; ownerId: OwnerId; notes?: string; txnId?: Id;
}

// ---------- snapshots
export interface NetWorthSnapshot extends Stamped {
  date: ISODate;
  byOwner: Record<OwnerId, { assets: Paise; liabilities: Paise }>;
}

export interface Tombstone { key: string; collection: string; id: Id; deletedAt: Timestamp }

// ---------- whole database
export const COLLECTIONS = [
  'categories', 'accounts', 'cardReports', 'transactions', 'investments', 'assets', 'valuations',
  'liabilities', 'emis', 'expectedItems', 'goals', 'goalAllocations', 'wasteEntries', 'snapshots',
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export interface Database {
  settings: Settings;
  categories: Category[];
  accounts: Account[];
  cardReports: CardReport[];
  transactions: Transaction[];
  investments: Investment[];
  assets: Asset[];
  valuations: Valuation[];
  liabilities: Liability[];
  emis: Emi[];
  expectedItems: ExpectedItem[];
  goals: Goal[];
  goalAllocations: GoalAllocation[];
  wasteEntries: WasteEntry[];
  snapshots: NetWorthSnapshot[];
  tombstones: Tombstone[];
}
