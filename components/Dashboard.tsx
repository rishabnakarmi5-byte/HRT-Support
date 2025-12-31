
import React, { useMemo } from 'react';
import { BatchEntry, ConcreteStep, ForecastSummary } from '../types';
import { TOTAL_TUNNEL_LENGTH } from '../constants';
import { formatChainage, calculateDesignQty } from '../utils';

interface DashboardProps {
  entries: BatchEntry[];
  totals: { 
      actual: number; 
      designed: number; 
      survey: number; 
      actualForSurvey: number;
      maxConcreted: number; 
      overbreakFactor: number 
  };
  forecast: ForecastSummary;
  onDelete: (id: string) => void;
  onEdit: (entry: BatchEntry) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ entries, totals, forecast, onDelete, onEdit }) => {
  // KPI Percentages
  // Percent Complete based on LENGTH now for clarity in progress bar
  const lengthPercent = (totals.maxConcreted / TOTAL_TUNNEL_LENGTH) * 100;
  
  const overbreakPct = (forecast.currentOverbreakRate - 1) * 100;
  const surveyVarianceVol = totals.actualForSurvey - totals.survey;
  const surveyVariancePercent = totals.survey > 0 ? (surveyVarianceVol / totals.survey) * 100 : 0;

  // Calculate Table Footer Sums
  const tableSums = useMemo(() => {
    return entries.reduce((acc, entry) => {
        const isGantry = entry.step === ConcreteStep.GANTRY;
        // If Gantry, we compare Cumulative Actual (Total Profile) vs Calculated Total Profile Design
        const displayActual = isGantry ? (entry.cumulativeActualQty || entry.actualQty) : entry.actualQty;
        
        // Recalculate Design for Gantry to ensure we are comparing Total Profile vs Total Profile
        // This handles older data where designedQty might have been saved as Gantry-only.
        const displayDesign = isGantry 
            ? calculateDesignQty(entry.fromChainage, entry.toChainage, ConcreteStep.SUM)
            : entry.designedQty;

        const varSurvey = isGantry ? displayActual - entry.surveyQty : 0;
        const varDesign = displayActual - displayDesign;
        const length = Math.abs(entry.toChainage - entry.fromChainage);

        return {
            length: acc.length + length,
            design: acc.design + displayDesign,
            survey: acc.survey + entry.surveyQty,
            actual: acc.actual + displayActual,
            varSurvey: acc.varSurvey + varSurvey,
            varDesign: acc.varDesign + varDesign
        };
    }, { length: 0, design: 0, survey: 0, actual: 0, varSurvey: 0, varDesign: 0 });
  }, [entries]);

  return (
    <div className="space-y-6">
      
      {/* 1. High Level Project Status */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Project Scope */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
           <div className="absolute right-0 top-0 w-16 h-16 bg-blue-50 rounded-bl-full -mr-2 -mt-2"></div>
           <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider relative z-10">Total Project Scope (Design)</p>
           <p className="text-2xl font-bold mt-1 text-slate-800 relative z-10">{forecast.totalProjectScope.toLocaleString(undefined, {maximumFractionDigits: 0})} m³</p>
           <p className="mt-2 text-xs text-gray-400 relative z-10">Length: {TOTAL_TUNNEL_LENGTH}m</p>
        </div>

        {/* Work Done */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
           <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Total Concrete Poured</p>
           <p className="text-2xl font-bold mt-1 text-blue-600">{forecast.completedActual.toLocaleString(undefined, {maximumFractionDigits: 2})} m³</p>
           <div className="mt-2 flex items-center">
             <div className="w-full bg-gray-100 rounded-full h-1.5 mr-2">
               <div className="bg-blue-600 h-1.5 rounded-full" style={{width: `${Math.min(100, lengthPercent)}%`}}></div>
             </div>
             <span className="text-[10px] font-bold text-gray-500" title="Length Completed">{lengthPercent.toFixed(1)}%</span>
           </div>
           <p className="text-[9px] text-gray-400 mt-1">Length Done: {totals.maxConcreted.toFixed(1)}m</p>
        </div>

         {/* Forecast Remaining */}
         <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
           <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Forecast To Complete</p>
           <p className="text-2xl font-bold mt-1 text-slate-700">{forecast.forecastToComplete.toLocaleString(undefined, {maximumFractionDigits: 0})} m³</p>
           <p className="mt-2 text-xs text-gray-400">At current over-consumption rate</p>
        </div>

        {/* Projected Grand Total */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm border-l-4 border-l-purple-500">
           <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Projected Grand Total</p>
           <p className="text-2xl font-bold mt-1 text-purple-700">{forecast.projectedGrandTotal.toLocaleString(undefined, {maximumFractionDigits: 0})} m³</p>
           <div className="flex items-center space-x-1 mt-2">
             <span className={`text-xs font-bold ${overbreakPct >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                {overbreakPct > 0 ? '+' : ''}{overbreakPct.toFixed(1)}%
             </span>
             <span className="text-[10px] text-gray-400">vs Design</span>
           </div>
        </div>
      </div>

      {/* 2. Detailed Performance KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Comparison: Actual vs Design */}
        <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 flex justify-between items-center">
             <div>
                <h4 className="text-sm font-bold text-orange-800">Financial Performance</h4>
                <p className="text-xs text-orange-600 mt-1">Comparing Actual Poured vs Theoretical Design</p>
             </div>
             <div className="text-right">
                <p className="text-xl font-bold text-orange-900">{forecast.currentOverbreakRate.toFixed(3)}x</p>
                <p className="text-[10px] text-orange-700 font-bold uppercase">Consumption Factor</p>
             </div>
        </div>

         {/* Comparison: Actual vs Survey */}
         <div className="bg-green-50 p-4 rounded-xl border border-green-100 flex justify-between items-center">
             <div>
                <h4 className="text-sm font-bold text-green-800">Engineering Performance</h4>
                <p className="text-xs text-green-600 mt-1">Comparing Actual Poured vs Net Survey</p>
             </div>
             <div className="text-right">
                <p className={`text-xl font-bold ${surveyVariancePercent > 5 ? 'text-red-600' : 'text-green-900'}`}>
                    {surveyVariancePercent > 0 ? '+' : ''}{surveyVariancePercent.toFixed(1)}%
                </p>
                <p className="text-[10px] text-green-700 font-bold uppercase">Variance</p>
             </div>
        </div>
      </div>

      {/* 3. Logs Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
          <h2 className="font-bold text-gray-800">Concrete Logs & Comparisons</h2>
          <span className="text-xs text-gray-500">{entries.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600 uppercase text-[10px] font-bold border-b">
              <tr>
                <th className="px-6 py-3">Chainage</th>
                <th className="px-6 py-3">Step</th>
                <th className="px-6 py-3">Design (Total)</th>
                <th className="px-6 py-3">Survey (Net)</th>
                <th className="px-6 py-3">Actual (Cum.)</th>
                <th className="px-6 py-3">Var. (Act-Sur)</th>
                <th className="px-6 py-3">Var. (Act-Dgn)</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => {
                const isGantry = entry.step === ConcreteStep.GANTRY;
                const displayActual = isGantry ? (entry.cumulativeActualQty || entry.actualQty) : entry.actualQty;
                
                // Recalculate Design for Display logic
                const displayDesign = isGantry 
                  ? calculateDesignQty(entry.fromChainage, entry.toChainage, ConcreteStep.SUM)
                  : entry.designedQty;

                const varSurvey = isGantry ? displayActual - entry.surveyQty : null;
                const varDesign = displayActual - displayDesign;

                return (
                  <tr key={entry.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div className="font-mono text-xs font-bold text-gray-700">{formatChainage(entry.fromChainage)}</div>
                      <div className="font-mono text-[10px] text-gray-400">to {formatChainage(entry.toChainage)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                        isGantry ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {entry.step}
                      </span>
                    </td>
                    
                    {/* Design Column */}
                    <td className="px-6 py-4 font-mono font-bold text-gray-500">
                      {displayDesign.toFixed(2)}
                      {isGantry && <span className="text-[9px] text-gray-400 block">Total Profile</span>}
                    </td>

                    {/* Survey Column */}
                    <td className="px-6 py-4 font-mono font-bold text-slate-600">
                      {isGantry ? entry.surveyQty.toFixed(2) : '-'}
                    </td>

                    {/* Actual Column */}
                    <td className="px-6 py-4 font-mono font-bold text-black">
                      {displayActual.toFixed(2)}
                      {isGantry && entry.cumulativeActualQty && entry.cumulativeActualQty > entry.actualQty && (
                        <span className="text-[9px] text-gray-400 block" title="Includes Prior Invert/Kicker">Cum. Total</span>
                      )}
                    </td>

                    {/* Variance (Act - Survey) Column */}
                    <td className={`px-6 py-4 font-mono font-bold ${varSurvey && varSurvey > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {varSurvey !== null ? (varSurvey > 0 ? `+${varSurvey.toFixed(2)}` : varSurvey.toFixed(2)) : '-'}
                    </td>

                    {/* Variance (Act - Design) Column */}
                    <td className={`px-6 py-4 font-mono font-bold ${varDesign > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {varDesign > 0 ? `+${varDesign.toFixed(2)}` : varDesign.toFixed(2)}
                    </td>

                    <td className="px-6 py-4 flex space-x-2">
                      <button onClick={() => onEdit(entry)} className="text-blue-300 hover:text-blue-600 transition p-1 hover:bg-blue-50 rounded" title="Edit">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => onDelete(entry.id)} className="text-red-300 hover:text-red-600 transition p-1 hover:bg-red-50 rounded" title="Delete">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals Footer */}
            <tfoot className="bg-gray-100 font-bold text-gray-800 border-t-2 border-gray-200">
               <tr>
                  <td colSpan={2} className="px-6 py-4 text-right">
                     TOTALS<br/>
                     <span className="text-xs text-gray-500 font-normal">Length: {tableSums.length.toFixed(2)}m</span>
                  </td>
                  <td className="px-6 py-4 font-mono">{tableSums.design.toFixed(2)}</td>
                  <td className="px-6 py-4 font-mono">{tableSums.survey.toFixed(2)}</td>
                  <td className="px-6 py-4 font-mono">{tableSums.actual.toFixed(2)}</td>
                  <td className={`px-6 py-4 font-mono ${tableSums.varSurvey > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {tableSums.varSurvey > 0 ? '+' : ''}{tableSums.varSurvey.toFixed(2)}
                  </td>
                  <td className={`px-6 py-4 font-mono ${tableSums.varDesign > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {tableSums.varDesign > 0 ? '+' : ''}{tableSums.varDesign.toFixed(2)}
                  </td>
                  <td></td>
               </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
