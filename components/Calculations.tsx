import React, { useState } from 'react';
import { DEFAULT_RATES, ROCK_CLASS_DESIGN_DATA, INITIAL_CHAINAGE_MAP, EXCAVATION_DATA } from '../constants';
import { BatchEntry, ConcreteStep, SurveyPoint } from '../types';
import { formatChainage, getExcavationProfile } from '../utils';

interface CalculationsProps {
    entries?: BatchEntry[];
    surveyOverrides?: SurveyPoint[];
}

const Calculations: React.FC<CalculationsProps> = ({ entries = [], surveyOverrides = [] }) => {
  const [selectedEntryId, setSelectedEntryId] = useState<string>('');

  // Find the selected entry object
  const selectedEntry = entries.find(e => e.id === selectedEntryId);

  // Helper to generate debug logs for "Designed"
  const getDesignBreakdown = (entry: BatchEntry) => {
    const logs: string[] = [];
    let total = 0;
    const start = Math.min(entry.fromChainage, entry.toChainage);
    const end = Math.max(entry.fromChainage, entry.toChainage);
    const step = entry.step === ConcreteStep.GANTRY ? ConcreteStep.SUM : entry.step;

    logs.push(`Calculating Design for Range: ${formatChainage(start)} to ${formatChainage(end)} (${(end-start).toFixed(2)}m)`);
    logs.push(`Target Step: ${step} (Total Profile if Gantry)`);

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
                case ConcreteStep.SUM: unitArea = data.total; break;
            }
            const subTotal = length * unitArea;
            total += subTotal;
            logs.push(`> Intersection with Rock Class ${segment.rockClass}: ${length.toFixed(3)}m × ${unitArea.toFixed(3)} m²/m = ${subTotal.toFixed(3)} m³`);
        }
    });
    logs.push(`= Total Designed Volume: ${total.toFixed(3)} m³`);
    return logs;
  };

  // Helper to generate debug logs for "Expected" (Survey)
  const getExpectedBreakdown = (entry: BatchEntry) => {
      const logs: string[] = [];
      const start = Math.min(entry.fromChainage, entry.toChainage);
      const end = Math.max(entry.fromChainage, entry.toChainage);
      const length = end - start;
      
      if (entry.step !== ConcreteStep.GANTRY) {
          logs.push("Survey comparison is currently only active for Gantry/Full Profile steps.");
          return logs;
      }

      logs.push(`Calculating Expected (Net Survey) for: ${formatChainage(start)} to ${formatChainage(end)}`);

      // 1. Gross Volume with Override checks
      const relevantPoints = new Set<number>();
      relevantPoints.add(start);
      relevantPoints.add(end);
      EXCAVATION_DATA.forEach(p => { if (p.chainage > start && p.chainage < end) relevantPoints.add(p.chainage); });
      surveyOverrides.forEach(p => { if (p.chainage > start && p.chainage < end) relevantPoints.add(p.chainage); });
      const sortedCh = Array.from(relevantPoints).sort((a,b) => a - b);

      logs.push(`> Analyzing ${sortedCh.length} profile points (Original + Re-Surveys)...`);

      let totalGross = 0;
      let totalShotcrete = 0;

      for (let i = 0; i < sortedCh.length - 1; i++) {
        const c1 = sortedCh[i];
        const c2 = sortedCh[i+1];
        const dist = c2 - c1;
        
        const p1 = getExcavationProfile(c1, surveyOverrides);
        const p2 = getExcavationProfile(c2, surveyOverrides);
        
        const fill1 = Math.max(0, p1.area - DEFAULT_RATES.FINISHED_INNER_AREA);
        const fill2 = Math.max(0, p2.area - DEFAULT_RATES.FINISHED_INNER_AREA);
        const segVol = ((fill1 + fill2) / 2) * dist;
        totalGross += segVol;

        const isResurvey = p1.isResurvey && p2.isResurvey;
        let segShotcrete = 0;
        if (!isResurvey) {
            segShotcrete = dist * DEFAULT_RATES.SHOTCRETE_DEDUCTION;
            totalShotcrete += segShotcrete;
        }

        logs.push(`  - Seg ${formatChainage(c1)}-${formatChainage(c2)} (${dist.toFixed(1)}m): ${isResurvey ? '[RE-SURVEY]' : '[ORIGINAL]'}`);
        logs.push(`    Fill Area: ${fill1.toFixed(2)} -> ${fill2.toFixed(2)} | Vol: ${segVol.toFixed(2)}`);
        if (isResurvey) logs.push(`    Shotcrete Deduction DISABLED (New Survey)`);
      }

      logs.push(`= Gross Concrete Volume: ${totalGross.toFixed(3)} m³`);

      // 2. Deductions
      logs.push(`> Deduction: Shotcrete (Calculated per segment) = -${totalShotcrete.toFixed(3)} m³`);
      
      let masonry = 0;
      if (entry.stoneMasonryQty !== undefined) {
         masonry = entry.stoneMasonryQty;
         logs.push(`> Deduction: Stone Masonry (Specific Logged Value) = -${masonry.toFixed(3)} m³`);
      } else if (entry.hasMasonryDeduction) {
         masonry = DEFAULT_RATES.STONE_MASONRY_AREA * length;
         logs.push(`> Deduction: Stone Masonry (Legacy Rate) = -${masonry.toFixed(3)} m³`);
      } else {
         logs.push(`> Deduction: Stone Masonry = 0`);
      }

      const net = Math.max(0, totalGross - totalShotcrete - masonry);
      logs.push(`= Expected (Net Survey) Volume: ${net.toFixed(3)} m³`);

      return logs;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-10">
      
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-slate-900">System Calculations Logic</h2>
        <p className="text-slate-500 mt-2">Detailed explanation of how volumes, variances, and performance metrics are derived.</p>
      </div>

      {/* 1. Designed Volume */}
      <section className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center space-x-3 mb-4">
            <span className="bg-blue-100 text-blue-800 font-bold px-3 py-1 rounded-full text-sm">1</span>
            <h3 className="text-xl font-bold text-gray-800">Designed (as per drawing)</h3>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 font-mono text-sm space-y-2">
            <p><strong>Step 1:</strong> Identify Rock Class for the given chainage range.</p>
            <p><strong>Step 2:</strong> Look up Unit Area (m²/m) in <code className="bg-white px-1 rounded border">ROCK_CLASS_DESIGN_DATA</code>.</p>
            <p><strong>Step 3:</strong> <code className="text-blue-600">Design Vol = Length × Unit Area</code></p>
        </div>
      </section>

      {/* 2. Expected Volume */}
      <section className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center space-x-3 mb-4">
            <span className="bg-blue-100 text-blue-800 font-bold px-3 py-1 rounded-full text-sm">2</span>
            <h3 className="text-xl font-bold text-gray-800">Expected (as per excavation done / surveyed cross-section)</h3>
        </div>
        <p className="text-gray-600 mb-4 leading-relaxed">
            Calculated by integrating the excavation profile and subtracting deductions. The system now prioritizes <strong>Re-Survey Data</strong> if available.
        </p>

        <div className="space-y-6">
            <div>
                <h4 className="font-bold text-gray-700 mb-2">A. Gross Concrete Volume & Shotcrete</h4>
                <p className="text-sm text-gray-600 mb-2">
                    The system iterates through the chainage length in small segments. For each segment:
                </p>
                <div className="bg-gray-50 p-3 rounded border text-sm font-mono text-gray-700 space-y-2">
                    <p>1. Check if Re-Survey data exists. If yes, use New Area. If no, use Original Area.</p>
                    <p>2. Fill Area = Excavated Area - Finished Inner Area ({DEFAULT_RATES.FINISHED_INNER_AREA} m²)</p>
                    <p>3. If data is Original: <span className="text-red-500">Apply Shotcrete Deduction ({DEFAULT_RATES.SHOTCRETE_DEDUCTION} m³/m)</span>.</p>
                    <p>4. If data is Re-Survey: <span className="text-green-600 font-bold">Shotcrete Deduction = 0</span>.</p>
                </div>
            </div>
            
            <div className="p-3 bg-green-50 border border-green-200 rounded text-green-900 font-bold text-center">
                Expected = Gross Vol - (Condition Based Shotcrete) - Masonry Vol
            </div>
        </div>
      </section>

      {/* 3. Poured Volume */}
      <section className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center space-x-3 mb-4">
            <span className="bg-blue-100 text-blue-800 font-bold px-3 py-1 rounded-full text-sm">3</span>
            <h3 className="text-xl font-bold text-gray-800">Poured</h3>
        </div>
        <p className="text-gray-600 mb-4 leading-relaxed">
            When calculating Total Poured (Gantry), we look at previous Invert/Kicker batches.
        </p>
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 text-sm mb-4">
            <strong>Update:</strong> The system now dynamically calculates "Prior Concrete" by searching for all Invert/Kicker batches that overlap with the specific Gantry chainages, handling partial overlaps and mismatched start/end points mathematically.
        </div>
      </section>

      {/* 5. Calculation Inspector */}
      <section className="bg-slate-800 text-slate-100 p-8 rounded-2xl border border-slate-700 shadow-lg">
        <div className="flex items-center space-x-3 mb-6">
             <div className="bg-blue-500 p-2 rounded-lg text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
             </div>
             <h3 className="text-xl font-bold">Calculation Inspector</h3>
        </div>
        
        <p className="text-slate-400 text-sm mb-4">Select an existing log entry to trace the exact calculation path.</p>
        
        <select 
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none mb-6"
            value={selectedEntryId}
            onChange={(e) => setSelectedEntryId(e.target.value)}
        >
            <option value="">-- Select a Log Entry --</option>
            {entries.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(entry => (
                <option key={entry.id} value={entry.id}>
                    {entry.date} | {entry.step} | Ch: {formatChainage(entry.fromChainage)} - {formatChainage(entry.toChainage)}
                </option>
            ))}
        </select>

        {selectedEntry ? (
            <div className="space-y-6">
                
                {/* Designed Trace */}
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                    <h4 className="font-bold text-blue-400 mb-2 border-b border-slate-700 pb-2">1. Designed Volume Breakdown</h4>
                    <div className="space-y-1 font-mono text-xs text-slate-300">
                        {getDesignBreakdown(selectedEntry).map((line, i) => (
                            <div key={i} className={line.startsWith('=') ? "text-yellow-400 font-bold pt-2" : line.startsWith('>') ? "text-slate-400 pl-2" : ""}>{line}</div>
                        ))}
                    </div>
                </div>

                {/* Expected Trace */}
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                    <h4 className="font-bold text-green-400 mb-2 border-b border-slate-700 pb-2">2. Expected (Survey) Breakdown</h4>
                    {selectedEntry.step === ConcreteStep.GANTRY ? (
                        <div className="space-y-1 font-mono text-xs text-slate-300">
                            {getExpectedBreakdown(selectedEntry).map((line, i) => (
                                <div key={i} className={line.startsWith('=') ? "text-yellow-400 font-bold pt-2" : line.startsWith('>') ? "text-slate-400 pl-2" : line.startsWith('  -') ? "text-slate-500 pl-4" : ""}>{line}</div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-slate-500 italic">Not applicable for partial steps (Invert/Kicker).</p>
                    )}
                </div>

                {/* Poured Trace */}
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                    <h4 className="font-bold text-orange-400 mb-2 border-b border-slate-700 pb-2">3. Poured Volume Breakdown</h4>
                    <div className="space-y-1 font-mono text-xs text-slate-300">
                         <div>Actual Logged Qty: {selectedEntry.actualQty} m³</div>
                         {selectedEntry.step === ConcreteStep.GANTRY && (
                             <>
                                <div>+ Prior Invert: {selectedEntry.priorInvertQty || 0} m³</div>
                                <div>+ Prior Kicker: {selectedEntry.priorKickerQty || 0} m³</div>
                                <div className="text-yellow-400 font-bold pt-2">= Total Poured: {selectedEntry.cumulativeActualQty} m³</div>
                             </>
                         )}
                         {selectedEntry.step !== ConcreteStep.GANTRY && (
                             <div className="text-yellow-400 font-bold pt-2">= Total Poured: {selectedEntry.actualQty} m³</div>
                         )}
                    </div>
                </div>

            </div>
        ) : (
            <div className="text-center py-10 text-slate-600 italic border border-dashed border-slate-700 rounded-lg">
                No entry selected
            </div>
        )}

      </section>

    </div>
  );
};

export default Calculations;