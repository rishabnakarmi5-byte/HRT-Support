
import { ChainageMapEntry, ConcreteStep, RockClass, BatchEntry } from './types';
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

export const calculateGrossConcreteVolume = (from: number, to: number): number => {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  
  if (start === end) return 0;

  // 1. Get subset of points within range
  const points = EXCAVATION_DATA.filter(p => p.chainage >= start && p.chainage <= end)
                                .map(p => ({ chainage: p.chainage, area: p.area }));

  // Helper to interpolate Excavated Area at a specific chainage
  const interpolateArea = (targetCh: number): number => {
    // Exact match
    const exact = EXCAVATION_DATA.find(p => Math.abs(p.chainage - targetCh) < 0.001);
    if (exact) return exact.area;

    // Boundary checks - Clamp to nearest if out of bounds
    if (EXCAVATION_DATA.length === 0) return 0;
    if (targetCh <= EXCAVATION_DATA[0].chainage) return EXCAVATION_DATA[0].area;
    if (targetCh >= EXCAVATION_DATA[EXCAVATION_DATA.length - 1].chainage) return EXCAVATION_DATA[EXCAVATION_DATA.length - 1].area;

    // Find surrounding points
    let p1 = EXCAVATION_DATA[0];
    let p2 = EXCAVATION_DATA[EXCAVATION_DATA.length - 1];

    for (let i = 0; i < EXCAVATION_DATA.length - 1; i++) {
      if (EXCAVATION_DATA[i].chainage <= targetCh && EXCAVATION_DATA[i+1].chainage >= targetCh) {
        p1 = EXCAVATION_DATA[i];
        p2 = EXCAVATION_DATA[i+1];
        break;
      }
    }

    if (p1.chainage === p2.chainage) return p1.area;

    // Linear Interpolation
    const ratio = (targetCh - p1.chainage) / (p2.chainage - p1.chainage);
    return p1.area + (p2.area - p1.area) * ratio;
  };

  // 2. Add Start and End points if not present
  if (!points.find(p => Math.abs(p.chainage - start) < 0.001)) {
    points.unshift({ chainage: start, area: interpolateArea(start) });
  }
  if (!points.find(p => Math.abs(p.chainage - end) < 0.001)) {
    points.push({ chainage: end, area: interpolateArea(end) });
  }

  // 3. Sort points by chainage
  points.sort((a, b) => a.chainage - b.chainage);

  // 4. Calculate Volume using Trapezoidal Rule on "Concrete Fill Area"
  // Concrete Fill Area = Excavated Area - Finished Inner Area
  let totalVolume = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i+1];
    const segLen = p2.chainage - p1.chainage;

    const fillArea1 = Math.max(0, p1.area - DEFAULT_RATES.FINISHED_INNER_AREA);
    const fillArea2 = Math.max(0, p2.area - DEFAULT_RATES.FINISHED_INNER_AREA);

    totalVolume += ((fillArea1 + fillArea2) / 2) * segLen;
  }

  return totalVolume;
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

// Calculate the Theoretical Design Volume that has been covered by the logged entries
// This handles overlaps correctly by merging ranges first.
export const calculateCoveredDesignVolume = (entries: BatchEntry[], step: ConcreteStep): number => {
  // 1. Get ranges for this step
  const stepEntries = entries.filter(e => e.step === step);
  const ranges = stepEntries.map(e => ({
    start: Math.min(e.fromChainage, e.toChainage), 
    end: Math.max(e.fromChainage, e.toChainage)
  }));
  
  // 2. Merge overlapping ranges
  const mergedRanges = mergeRanges(ranges);
  
  // 3. Calculate design volume for these unique ranges against the Rock Map
  let coveredVolume = 0;
  
  mergedRanges.forEach(range => {
    coveredVolume += calculateDesignQty(range.start, range.end, step);
  });
  
  return coveredVolume;
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
