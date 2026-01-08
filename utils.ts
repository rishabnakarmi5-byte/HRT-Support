
import { ChainageMapEntry, ConcreteStep, RockClass, BatchEntry, SurveyPoint } from './types';
import { ROCK_CLASS_DESIGN_DATA, INITIAL_CHAINAGE_MAP, EXCAVATION_DATA, DEFAULT_RATES } from './constants';

export const calculateDesignQty = (from: number, to: number, step: ConcreteStep): number => {
  let totalQty = 0;
  const start = Math.min(from, to);
  const end = Math.max(from, to);

  INITIAL_CHAINAGE_MAP.forEach((segment) => {
    const overlapStart = Math.max(start, segment.from);
    const overlapEnd = Math.min(end, segment.to);

    if (overlapStart < overlapEnd) {
      const length = overlapEnd - overlapStart;
      const data = ROCK_CLASS_DESIGN_DATA[segment.rockClass];
      
      let unitArea = 0;
      switch (step) {
        case ConcreteStep.INVERT: unitArea = data.invert; break;
        case ConcreteStep.KICKER: unitArea = data.kicker; break;
        case ConcreteStep.GANTRY: unitArea = data.gantry; break;
        case ConcreteStep.SUM: unitArea = data.total; break;
      }
      
      totalQty += length * unitArea;
    }
  });

  return parseFloat(totalQty.toFixed(3));
};

// Helper: Interpolate Area from a dataset (Points must be sorted)
const interpolateFromSet = (targetCh: number, dataset: {chainage: number, area: number}[]): number | null => {
    if (dataset.length === 0) return null;
    
    // Bounds check - if dataset covers this chainage
    const minCh = dataset[0].chainage;
    const maxCh = dataset[dataset.length-1].chainage;

    // Use a small tolerance or strict checking. 
    // If strict: if (targetCh < minCh || targetCh > maxCh) return null;
    // However, for gaps between separate survey blocks, strict is better.
    if (targetCh < minCh || targetCh > maxCh) return null;

    // Exact match
    const exact = dataset.find(p => Math.abs(p.chainage - targetCh) < 0.001);
    if (exact) return exact.area;

    // Find surrounding points
    for (let i = 0; i < dataset.length - 1; i++) {
        if (dataset[i].chainage <= targetCh && dataset[i+1].chainage >= targetCh) {
            const p1 = dataset[i];
            const p2 = dataset[i+1];
            // Linear Interpolation
            const ratio = (targetCh - p1.chainage) / (p2.chainage - p1.chainage);
            return p1.area + (p2.area - p1.area) * ratio;
        }
    }
    return null;
}

// Helper: Get Profile Area and Type (Original vs New Survey)
export const getExcavationProfile = (ch: number, surveyPoints: SurveyPoint[]): { area: number, isResurvey: boolean } => {
    // 1. Try New Survey Data First (Sorted check implies we should sort surveyPoints before passing, but we'll sort here to be safe if small)
    // Optimization: Assume surveyPoints passed are sorted.
    
    if (surveyPoints.length > 1) {
        // Find if 'ch' falls within the range of any contiguous survey block? 
        // Simple approach: See if we can interpolate.
        const surveyArea = interpolateFromSet(ch, surveyPoints);
        if (surveyArea !== null) {
            return { area: surveyArea, isResurvey: true };
        }
    }

    // 2. Fallback to Original Excavation Data
    // We treat EXCAVATION_DATA as continuous for the whole tunnel essentially
    const origArea = interpolateFromSet(ch, EXCAVATION_DATA);
    
    // Fallback for out of bounds (shouldn't happen with full data)
    if (origArea !== null) return { area: origArea, isResurvey: false };
    
    // Extreme fallback (clamp to nearest)
    if (ch < EXCAVATION_DATA[0].chainage) return { area: EXCAVATION_DATA[0].area, isResurvey: false };
    return { area: EXCAVATION_DATA[EXCAVATION_DATA.length-1].area, isResurvey: false };
};


export const calculateExpectedConcreteVolume = (from: number, to: number, surveyPoints: SurveyPoint[] = []) => {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) return { gross: 0, shotcrete: 0 };

  // Generate Integration Points
  // We include start, end, and all points from EXCAVATION_DATA and surveyPoints that fall within range
  // to ensure trapezoidal accuracy.
  
  const relevantPoints = new Set<number>();
  relevantPoints.add(start);
  relevantPoints.add(end);

  EXCAVATION_DATA.forEach(p => {
      if (p.chainage > start && p.chainage < end) relevantPoints.add(p.chainage);
  });
  surveyPoints.forEach(p => {
      if (p.chainage > start && p.chainage < end) relevantPoints.add(p.chainage);
  });

  const sortedCh = Array.from(relevantPoints).sort((a,b) => a - b);

  let totalGross = 0;
  let totalShotcreteDeduction = 0;

  for (let i = 0; i < sortedCh.length - 1; i++) {
      const c1 = sortedCh[i];
      const c2 = sortedCh[i+1];
      const dist = c2 - c1;

      const p1 = getExcavationProfile(c1, surveyPoints);
      const p2 = getExcavationProfile(c2, surveyPoints);

      // Trapezoidal Rule for Concrete Fill Area
      const fill1 = Math.max(0, p1.area - DEFAULT_RATES.FINISHED_INNER_AREA);
      const fill2 = Math.max(0, p2.area - DEFAULT_RATES.FINISHED_INNER_AREA);
      
      const sliceVol = ((fill1 + fill2) / 2) * dist;
      totalGross += sliceVol;

      // Shotcrete Deduction
      // If BOTH points are re-survey, we assume the segment is re-surveyed -> No Deduction.
      // If mixed or both original -> Apply deduction.
      // (Strictly: if we have survey data, it includes shotcrete, so no deduction needed).
      
      const isSegmentResurveyed = p1.isResurvey && p2.isResurvey;
      
      if (!isSegmentResurveyed) {
          totalShotcreteDeduction += (dist * DEFAULT_RATES.SHOTCRETE_DEDUCTION);
      }
  }

  return { gross: totalGross, shotcrete: totalShotcreteDeduction };
};

// Old function wrapper for backward compatibility if needed, but we should switch to above
export const calculateGrossConcreteVolume = (from: number, to: number): number => {
    return calculateExpectedConcreteVolume(from, to, []).gross;
}

// ---------------------------------------------------------
// NEW: Prior Concrete Interpolation for Mismatched Chainages
// ---------------------------------------------------------
export const calculatePriorConcreteVolume = (
    targetFrom: number, 
    targetTo: number, 
    stepToFind: ConcreteStep, 
    allEntries: BatchEntry[]
): number => {
    const targetStart = Math.min(targetFrom, targetTo);
    const targetEnd = Math.max(targetFrom, targetTo);
    const targetLen = targetEnd - targetStart;

    if (targetLen <= 0) return 0;

    // Filter relevant batches
    const relevantBatches = allEntries.filter(e => e.step === stepToFind);

    let totalVolumeFound = 0;

    relevantBatches.forEach(batch => {
        const batchStart = Math.min(batch.fromChainage, batch.toChainage);
        const batchEnd = Math.max(batch.fromChainage, batch.toChainage);
        const batchLen = batchEnd - batchStart;

        // Check Overlap
        const overlapStart = Math.max(targetStart, batchStart);
        const overlapEnd = Math.min(targetEnd, batchEnd);

        if (overlapStart < overlapEnd) {
            const overlapLen = overlapEnd - overlapStart;
            
            // Linear density of the batch
            const linearDensity = batch.actualQty / batchLen;
            
            // Volume contribution
            totalVolumeFound += linearDensity * overlapLen;
        }
    });

    return totalVolumeFound;
};

// Merge ranges to handle overlapping entries
export const mergeRanges = (ranges: {start: number, end: number}[]) => {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const current = merged[merged.length - 1];
    if (next.start < current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(next);
    }
  }
  return merged;
};

export const calculateUnionLength = (entries: BatchEntry[]): number => {
  if (entries.length === 0) return 0;
  const intervals = entries.map(e => ({
    start: Math.min(e.fromChainage, e.toChainage),
    end: Math.max(e.fromChainage, e.toChainage)
  }));
  const merged = mergeRanges(intervals);
  return merged.reduce((acc, curr) => acc + (curr.end - curr.start), 0);
};

export const formatChainage = (value: number): string => {
  const km = Math.floor(value / 1000);
  const m = (value % 1000).toFixed(2);
  return `${km}+${m.padStart(6, '0')}`;
};

// Parse string like "0+922" or "1+040" to number
export const parseChainage = (value: string): number => {
  if (!value) return 0;
  const clean = value.replace(/\s/g, '');
  if (clean.includes('+')) {
    const [km, m] = clean.split('+');
    return (parseFloat(km) * 1000) + parseFloat(m);
  }
  return parseFloat(clean);
};
