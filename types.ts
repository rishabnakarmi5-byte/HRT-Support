
export enum RockClass {
  III = 'III',
  IV = 'IV',
  VA = 'VA',
  VB = 'VB'
}

export enum ConcreteStep {
  INVERT = 'Invert',
  KICKER = 'Kicker',
  GANTRY = 'Gantry',
  SUM = 'Total Sum'
}

export interface RockClassData {
  invert: number;
  kicker: number;
  gantry: number;
  total: number;
}

export interface ChainageMapEntry {
  from: number;
  to: number;
  rockClass: RockClass;
}

export interface ExcavationRecord {
  chainage: number;
  area: number;
  rockClass: RockClass;
}

export interface BatchEntry {
  id: string;
  date: string;
  fromChainage: number;
  toChainage: number;
  step: ConcreteStep;
  surveyQty: number; // For Gantry: Total Net Survey. For others: 0/NA
  grossConcreteQty: number; 
  actualQty: number; // The specific batch amount (e.g. just Gantry)
  cumulativeActualQty?: number; // The Total amount (Gantry + Prior) for comparison
  priorInvertQty?: number; // Specific prior amount for Invert (Gantry only)
  priorKickerQty?: number; // Specific prior amount for Kicker (Gantry only)
  designedQty: number; // Theoretical Design (Total for Gantry, Partial for others)
  notes?: string;
  isDefault?: boolean;
  hasMasonryDeduction: boolean;
  shotcreteDeduction: number;
}

export interface ForecastSummary {
  totalProjectScope: number; // Total Design Volume for 2606m
  completedDesign: number; // Design Volume of completed sections
  completedActual: number; // Actual Volume of completed sections
  remainingLength: number;
  remainingDesign: number; // Scope - CompletedDesign
  currentOverbreakRate: number; // CompletedActual / CompletedDesign
  forecastToComplete: number; // RemainingDesign * Rate
  projectedGrandTotal: number; // CompletedActual + ForecastToComplete
}
