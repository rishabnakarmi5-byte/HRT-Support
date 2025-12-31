
import React, { useState, useEffect, useMemo } from 'react';
import { BatchEntry, ConcreteStep, ForecastSummary } from './types';
import { TOTAL_TUNNEL_LENGTH, INITIAL_CHAINAGE_MAP, ROCK_CLASS_DESIGN_DATA, DEFAULT_RATES } from './constants';
import { calculateDesignQty, formatChainage, calculateUnionLength, calculateCoveredDesignVolume, mergeRanges } from './utils';
import Dashboard from './components/Dashboard';
import DataEntry from './components/DataEntry';
import Analysis from './components/Analysis';
import Parameters from './components/Parameters';
import Calculations from './components/Calculations';

const App: React.FC = () => {
  // FIX: Load data immediately during initialization to prevent overwriting with empty array
  const [entries, setEntries] = useState<BatchEntry[]>(() => {
    try {
      const saved = localStorage.getItem('hrt_concrete_data');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to load data", e);
      return [];
    }
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'entry' | 'analysis' | 'params' | 'calcs'>('dashboard');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // Save data to localStorage whenever entries change
  useEffect(() => {
    localStorage.setItem('hrt_concrete_data', JSON.stringify(entries));
  }, [entries]);

  // Handle saving new or updated entries
  const handleSave = (newEntriesData: Omit<BatchEntry, 'id' | 'designedQty'>[], isEdit: boolean = false) => {
    const processed = newEntriesData.map(data => {
      // For Gantry, we want to compare against the Total Profile (Invert + Kicker + Gantry) design
      // because the Actual Qty (Cumulative) includes all three.
      const designStep = data.step === ConcreteStep.GANTRY ? ConcreteStep.SUM : data.step;
      
      return {
        ...data,
        // If edit, use the existing editingEntryId. For bulk or new single, generate new.
        id: isEdit && editingEntryId ? editingEntryId : crypto.randomUUID(),
        designedQty: calculateDesignQty(data.fromChainage, data.toChainage, designStep)
      };
    });

    if (isEdit && editingEntryId && processed.length === 1) {
       // Update existing entry while preserving ID
       setEntries(prev => prev.map(e => e.id === editingEntryId ? processed[0] : e));
       setEditingEntryId(null);
    } else {
       // Append new entries
       setEntries(prev => [...processed, ...prev]);
    }
    
    setActiveTab('dashboard');
  };

  const handleImport = (importedData: BatchEntry[]) => {
      if (confirm('Importing data will overwrite your current entries. Continue?')) {
          setEntries(importedData);
          setActiveTab('dashboard');
      }
  };

  const deleteEntry = (id: string) => {
    setEntries(entries.filter(e => e.id !== id));
  };

  const handleEdit = (entry: BatchEntry) => {
    setEditingEntryId(entry.id);
    setActiveTab('entry');
  };

  const handleTabChange = (tab: typeof activeTab) => {
    if (tab !== 'entry') {
      setEditingEntryId(null);
    }
    setActiveTab(tab);
  };

  const entryToEdit = useMemo(() => 
    editingEntryId ? entries.find(e => e.id === editingEntryId) : undefined
  , [editingEntryId, entries]);

  // 1. Calculate Total Project Design Volume (Static Scope)
  const totalProjectDesignVolume = useMemo(() => {
    return INITIAL_CHAINAGE_MAP.reduce((acc, seg) => {
      const segLen = seg.to - seg.from;
      // We are tracking Total Profile (Invert + Kicker + Gantry)
      return acc + (segLen * ROCK_CLASS_DESIGN_DATA[seg.rockClass].total);
    }, 0);
  }, []);

  const totals = useMemo(() => {
    // Modified: Total Concrete Poured now specifically sums the Gantry Cumulative Volume.
    // This represents Gantry + Invert + Kicker (Total Profile) as requested.
    // We assume Gantry entries are the primary record for completed full-profile sections.
    const gantryEntries = entries.filter(e => e.step === ConcreteStep.GANTRY);
    
    // Summing cumulativeActualQty for Gantry entries gives us the Full Profile Poured.
    // If no Gantry entries exist yet, we fall back to summing raw actuals of other steps.
    const totalActualPoured = gantryEntries.length > 0 
      ? gantryEntries.reduce((acc, curr) => acc + (curr.cumulativeActualQty || curr.actualQty), 0)
      : entries.reduce((acc, curr) => acc + curr.actualQty, 0);
    
    // Design Volume "Covered" by logs.
    const totalDesignedSum = entries.reduce((acc, curr) => acc + curr.designedQty, 0);
    
    // Survey sum
    const totalSurvey = entries.reduce((acc, curr) => acc + curr.surveyQty, 0);
    
    const totalActualForSurveyComparison = gantryEntries.reduce((acc, curr) => acc + (curr.cumulativeActualQty || 0), 0);
    const progress = calculateUnionLength(gantryEntries);

    return { 
        actual: totalActualPoured, 
        designed: totalDesignedSum, 
        survey: totalSurvey, 
        actualForSurvey: totalActualForSurveyComparison,
        progress
    };
  }, [entries]);

  const forecast = useMemo((): ForecastSummary => {
    // 1. Calculate Consumed Design Volume
    // Since we are tracking "Total Profile" completion via Gantry entries,
    // we must calculate the Design Volume for the Total Profile (SUM) for the length covered by Gantry.
    const gantryEntries = entries.filter(e => e.step === ConcreteStep.GANTRY);
    
    // Merge overlapping gantry ranges to get true linear coverage
    const intervals = gantryEntries.map(e => ({
      start: Math.min(e.fromChainage, e.toChainage),
      end: Math.max(e.fromChainage, e.toChainage)
    }));
    const mergedRanges = mergeRanges(intervals);
    
    // Sum Design Qty (Total Profile) for these ranges
    let completedDesign = 0;
    mergedRanges.forEach(range => {
        completedDesign += calculateDesignQty(range.start, range.end, ConcreteStep.SUM);
    });

    const completedActual = totals.actual;

    // 2. Remaining Design
    const remainingDesign = Math.max(0, totalProjectDesignVolume - completedDesign);

    // 3. Current Performance Rate
    let currentOverbreakRate = 1.05;
    if (completedDesign > 0) {
        currentOverbreakRate = completedActual / completedDesign;
    }
    const safeRate = Math.max(0.8, Math.min(currentOverbreakRate, 2.0));

    // 4. Forecasts
    const forecastToComplete = remainingDesign * safeRate;
    const projectedGrandTotal = completedActual + forecastToComplete;
    const remainingLength = Math.max(0, TOTAL_TUNNEL_LENGTH - totals.progress);

    return {
      totalProjectScope: totalProjectDesignVolume,
      completedDesign,
      completedActual,
      remainingLength,
      remainingDesign,
      currentOverbreakRate,
      forecastToComplete,
      projectedGrandTotal
    };
  }, [totals, entries, totalProjectDesignVolume]);

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight">HRT Concrete Tracker</h1>
          </div>
          <nav className="hidden md:flex space-x-1 bg-slate-800 p-1 rounded-md">
            <button 
              onClick={() => handleTabChange('dashboard')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
            >
              Dashboard
            </button>
            <button 
              onClick={() => handleTabChange('entry')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'entry' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
            >
              Log Batch
            </button>
            <button 
              onClick={() => handleTabChange('analysis')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'analysis' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
            >
              Analysis
            </button>
            <button 
              onClick={() => handleTabChange('calcs')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'calcs' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
            >
              Logic
            </button>
            <button 
              onClick={() => handleTabChange('params')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'params' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
            >
              Check Values
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-grow container mx-auto p-4 md:p-6 pb-20">
        {activeTab === 'dashboard' && (
            <Dashboard 
                entries={entries} 
                totals={{
                    actual: totals.actual,
                    designed: totals.designed,
                    survey: totals.survey,
                    actualForSurvey: totals.actualForSurvey,
                    maxConcreted: totals.progress,
                    overbreakFactor: forecast.currentOverbreakRate
                }} 
                forecast={forecast} 
                onDelete={deleteEntry} 
                onEdit={handleEdit} 
            />
        )}
        {activeTab === 'entry' && (
            <DataEntry 
                onSave={handleSave} 
                entries={entries}
                onImport={handleImport}
                entryToEdit={entryToEdit} 
            />
        )}
        {activeTab === 'analysis' && <Analysis entries={entries} totalLength={TOTAL_TUNNEL_LENGTH} forecast={forecast} />}
        {activeTab === 'params' && <Parameters />}
        {activeTab === 'calcs' && <Calculations entries={entries} />}
      </main>

      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t p-3 flex justify-around shadow-inner z-50">
         <button onClick={() => handleTabChange('dashboard')} className={`flex flex-col items-center text-xs ${activeTab === 'dashboard' ? 'text-blue-600' : 'text-gray-500'}`}>
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
           Dash
         </button>
         <button onClick={() => handleTabChange('entry')} className="flex flex-col items-center text-xs text-blue-600 font-bold">
           <svg className="w-10 h-10 bg-blue-600 text-white rounded-full p-2 -mt-8 border-4 border-gray-50 shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
           Log
         </button>
         <button onClick={() => handleTabChange('calcs')} className={`flex flex-col items-center text-xs ${activeTab === 'calcs' ? 'text-blue-600' : 'text-gray-500'}`}>
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
           Logic
         </button>
      </div>
    </div>
  );
};

export default App;
