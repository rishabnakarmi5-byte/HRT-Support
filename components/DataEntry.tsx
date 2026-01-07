import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ConcreteStep, BatchEntry } from '../types';
import { DEFAULT_RATES } from '../constants';
import { calculateGrossConcreteVolume, calculateDesignQty, parseChainage } from '../utils';

interface DataEntryProps {
  onSave: (entries: Omit<BatchEntry, 'id' | 'designedQty'>[], isEdit?: boolean) => void;
  entries?: BatchEntry[]; // For export
  onImport?: (data: BatchEntry[]) => void;
  entryToEdit?: BatchEntry;
}

const DataEntry: React.FC<DataEntryProps> = ({ onSave, entries, onImport, entryToEdit }) => {
  const [mode, setMode] = useState<'manual' | 'bulk' | 'manage'>('manual');
  
  // Manual State
  const [formData, setFormData] = useState({
    fromChainage: '',
    toChainage: '',
    step: ConcreteStep.GANTRY,
    actualQty: '', 
    priorInvert: '', 
    priorKicker: '',
    stoneMasonry: '', // New field for variable masonry volume
    notes: '',
  });

  // Bulk State
  const [bulkText, setBulkText] = useState('');
  const [bulkStep, setBulkStep] = useState(ConcreteStep.GANTRY);

  // Import State
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Edit Mode
  useEffect(() => {
    if (entryToEdit) {
      setMode('manual');
      
      const cumulative = entryToEdit.cumulativeActualQty || entryToEdit.actualQty;
      const priorTotal = Math.max(0, cumulative - entryToEdit.actualQty);
      
      let pInvert = entryToEdit.priorInvertQty?.toString() || '';
      let pKicker = entryToEdit.priorKickerQty?.toString() || '';

      if (priorTotal > 0 && !pInvert && !pKicker) {
         const ratio = DEFAULT_RATES.AVG_ACTUAL_INVERT / (DEFAULT_RATES.AVG_ACTUAL_INVERT + DEFAULT_RATES.AVG_ACTUAL_KICKER);
         pInvert = (priorTotal * ratio).toFixed(2);
         pKicker = (priorTotal * (1-ratio)).toFixed(2);
      }

      // Handle Masonry: use stored qty, or calculate from boolean if missing
      const length = Math.abs(entryToEdit.toChainage - entryToEdit.fromChainage);
      let masonryVal = '';
      if (entryToEdit.stoneMasonryQty !== undefined) {
          masonryVal = entryToEdit.stoneMasonryQty.toString();
      } else if (entryToEdit.hasMasonryDeduction) {
          masonryVal = (length * DEFAULT_RATES.STONE_MASONRY_AREA).toFixed(2);
      }

      setFormData({
        fromChainage: entryToEdit.fromChainage.toString(),
        toChainage: entryToEdit.toChainage.toString(),
        step: entryToEdit.step,
        actualQty: entryToEdit.actualQty.toString(),
        priorInvert: pInvert,
        priorKicker: pKicker,
        stoneMasonry: masonryVal,
        notes: entryToEdit.notes || ''
      });
    }
  }, [entryToEdit]);

  // Auto-calculate Prior Qty (Defaults)
  const fromVal = parseFloat(formData.fromChainage);
  const toVal = parseFloat(formData.toChainage);
  const length = isNaN(fromVal) || isNaN(toVal) ? 0 : Math.abs(toVal - fromVal);

  useEffect(() => {
    if (mode === 'manual' && length > 0 && formData.step === ConcreteStep.GANTRY && !entryToEdit) {
        if (formData.priorInvert === '' && formData.priorKicker === '') {
            setFormData(prev => ({
                ...prev,
                priorInvert: (length * DEFAULT_RATES.AVG_ACTUAL_INVERT).toFixed(2),
                priorKicker: (length * DEFAULT_RATES.AVG_ACTUAL_KICKER).toFixed(2)
            }));
        }
    }
  }, [length, mode, formData.step, entryToEdit]);

  // Calculations for display/save
  const calc = useMemo(() => {
    if (length <= 0) return { gross: 0, netSurvey: 0, design: 0 };
    
    const grossVol = calculateGrossConcreteVolume(fromVal, toVal);
    const shotcreteDec = DEFAULT_RATES.SHOTCRETE_DEDUCTION * length;
    
    // Use manual input if present, otherwise 0
    const masonryDec = parseFloat(formData.stoneMasonry) || 0;
    
    const netSurvey = Math.max(0, grossVol - shotcreteDec - masonryDec);
    const design = calculateDesignQty(fromVal, toVal, formData.step === ConcreteStep.GANTRY ? ConcreteStep.SUM : formData.step);

    return { gross: grossVol, netSurvey, design, shotcreteDec, masonryDec };
  }, [fromVal, toVal, length, formData.stoneMasonry, formData.step]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const currentActual = parseFloat(formData.actualQty);
    
    const priorInvert = formData.step === ConcreteStep.GANTRY ? parseFloat(formData.priorInvert || '0') : 0;
    const priorKicker = formData.step === ConcreteStep.GANTRY ? parseFloat(formData.priorKicker || '0') : 0;
    
    const totalActual = currentActual + priorInvert + priorKicker;

    const entry: Omit<BatchEntry, 'id' | 'designedQty'> = {
      date: new Date().toISOString().split('T')[0],
      fromChainage: fromVal,
      toChainage: toVal,
      step: formData.step,
      surveyQty: formData.step === ConcreteStep.GANTRY ? calc.netSurvey : 0,
      grossConcreteQty: calc.gross,
      actualQty: currentActual,
      cumulativeActualQty: formData.step === ConcreteStep.GANTRY ? totalActual : currentActual,
      priorInvertQty: priorInvert,
      priorKickerQty: priorKicker,
      hasMasonryDeduction: calc.masonryDec > 0, // Legacy flag logic
      stoneMasonryQty: calc.masonryDec, // Specific value
      shotcreteDeduction: calc.shotcreteDec,
      notes: formData.notes
    };

    onSave([entry], !!entryToEdit);
    if (!entryToEdit) {
        setFormData({ fromChainage: '', toChainage: '', step: ConcreteStep.GANTRY, actualQty: '', priorInvert: '', priorKicker: '', stoneMasonry: '', notes: '' });
    }
  };

  const handleBulkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lines = bulkText.trim().split('\n');
    const newEntries: Omit<BatchEntry, 'id' | 'designedQty'>[] = [];

    lines.forEach(line => {
        // Expected format: From | To | Concrete | Masonry (Optional)
        const parts = line.split(/[\t,]+| {2,}/).map(s => s.trim()).filter(s => s);
        if (parts.length >= 3) {
            const f = parseChainage(parts[0]);
            const t = parseChainage(parts[1]);
            const act = parseFloat(parts[2]);
            const masonry = parts.length >= 4 ? parseFloat(parts[3]) : 0;
            
            if (!isNaN(f) && !isNaN(t) && !isNaN(act)) {
                const len = Math.abs(t - f);
                const grossVol = calculateGrossConcreteVolume(f, t);
                const shotcreteDec = DEFAULT_RATES.SHOTCRETE_DEDUCTION * len;
                const masonryDec = isNaN(masonry) ? 0 : masonry;
                
                const netSurvey = Math.max(0, grossVol - shotcreteDec - masonryDec);
                
                const priorInvert = len * DEFAULT_RATES.AVG_ACTUAL_INVERT;
                const priorKicker = len * DEFAULT_RATES.AVG_ACTUAL_KICKER;
                const totalPrior = priorInvert + priorKicker;

                newEntries.push({
                    date: new Date().toISOString().split('T')[0],
                    fromChainage: f,
                    toChainage: t,
                    step: bulkStep,
                    surveyQty: bulkStep === ConcreteStep.GANTRY ? netSurvey : 0,
                    grossConcreteQty: grossVol,
                    actualQty: act,
                    cumulativeActualQty: bulkStep === ConcreteStep.GANTRY ? (act + totalPrior) : act,
                    priorInvertQty: bulkStep === ConcreteStep.GANTRY ? priorInvert : 0,
                    priorKickerQty: bulkStep === ConcreteStep.GANTRY ? priorKicker : 0,
                    hasMasonryDeduction: masonryDec > 0,
                    stoneMasonryQty: masonryDec,
                    shotcreteDeduction: shotcreteDec,
                    notes: 'Bulk Imported'
                });
            }
        }
    });

    if (newEntries.length > 0) {
        onSave(newEntries, false);
        setBulkText('');
    }
  };

  const handleExport = () => {
    if (!entries) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(entries, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "hrt_concrete_data.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = JSON.parse(event.target?.result as string);
            if (Array.isArray(json) && onImport) {
                onImport(json);
                alert('Data imported successfully!');
            }
        } catch (err) {
            alert('Invalid JSON file');
        }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      
      {/* Tab Switcher */}
      <div className="flex border-b border-gray-200 mb-6">
          <button 
            className={`py-2 px-4 font-semibold ${mode === 'manual' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
            onClick={() => setMode('manual')}
          >
            {entryToEdit ? 'Editing Entry' : 'Manual Entry'}
          </button>
          {!entryToEdit && (
            <>
                <button 
                    className={`py-2 px-4 font-semibold ${mode === 'bulk' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
                    onClick={() => setMode('bulk')}
                >
                    Bulk Paste
                </button>
                <button 
                    className={`py-2 px-4 font-semibold ${mode === 'manage' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
                    onClick={() => setMode('manage')}
                >
                    Manage Data
                </button>
            </>
          )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        
        {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Lining Step</label>
              <select 
                value={formData.step}
                onChange={e => setFormData({...formData, step: e.target.value as ConcreteStep})}
                className="w-full border rounded-lg p-2.5 bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {Object.values(ConcreteStep).filter(s => s !== ConcreteStep.SUM).map(step => (
                  <option key={step} value={step}>{step}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">From Chainage (m)</label>
              <input 
                type="number" step="0.001" required
                placeholder="e.g. 1210.000"
                value={formData.fromChainage}
                onChange={e => setFormData({...formData, fromChainage: e.target.value})}
                className="w-full border rounded-lg p-2.5 bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">To Chainage (m)</label>
              <input 
                type="number" step="0.001" required
                placeholder="e.g. 1219.000"
                value={formData.toChainage}
                onChange={e => setFormData({...formData, toChainage: e.target.value})}
                className="w-full border rounded-lg p-2.5 bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
              />
            </div>
          </div>

          <div className="p-5 bg-blue-50 border border-blue-100 rounded-xl space-y-4">
            <h3 className="text-xs font-bold text-blue-700 uppercase mb-2">Concrete Quantities</h3>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-blue-900">
                  {formData.step} Dispatched (Plant)
                </label>
                <input 
                  type="number" step="0.01" required
                  placeholder="e.g. 75.50"
                  value={formData.actualQty}
                  onChange={e => setFormData({...formData, actualQty: e.target.value})}
                  className="w-full border-blue-200 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              {formData.step === ConcreteStep.GANTRY && (
                <>
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-blue-200">
                    <div className="col-span-2 text-[10px] text-blue-600 font-bold uppercase tracking-wider">
                        Prior Concrete (Invert + Kicker)
                    </div>
                    
                    <div className="space-y-1">
                        <div className="flex justify-between items-baseline">
                           <label className="text-xs font-semibold text-blue-800">Prior Invert</label>
                           <span className="text-[9px] text-blue-400">Def: {DEFAULT_RATES.AVG_ACTUAL_INVERT}</span>
                        </div>
                        <input 
                            type="number" step="0.01" required
                            placeholder="Auto"
                            value={formData.priorInvert}
                            onChange={e => setFormData({...formData, priorInvert: e.target.value})}
                            className="w-full border-blue-200 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                        />
                    </div>

                    <div className="space-y-1">
                        <div className="flex justify-between items-baseline">
                           <label className="text-xs font-semibold text-blue-800">Prior Kicker</label>
                           <span className="text-[9px] text-blue-400">Def: {DEFAULT_RATES.AVG_ACTUAL_KICKER}</span>
                        </div>
                        <input 
                            type="number" step="0.01" required
                            placeholder="Auto"
                            value={formData.priorKicker}
                            onChange={e => setFormData({...formData, priorKicker: e.target.value})}
                            className="w-full border-blue-200 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                        />
                    </div>
                </div>

                <div className="pt-2 border-t border-blue-200 space-y-1">
                    <div className="flex justify-between items-center">
                         <label className="text-xs font-semibold text-blue-900 uppercase">Stone Masonry Deduction (m³)</label>
                         <button 
                            type="button" 
                            onClick={() => setFormData({...formData, stoneMasonry: (length * DEFAULT_RATES.STONE_MASONRY_AREA).toFixed(2)})}
                            className="text-[9px] text-blue-500 underline hover:text-blue-700"
                        >
                            Auto Calc ({DEFAULT_RATES.STONE_MASONRY_AREA}m²/m)
                         </button>
                    </div>
                    <input 
                        type="number" step="0.01"
                        placeholder="0.00"
                        value={formData.stoneMasonry}
                        onChange={e => setFormData({...formData, stoneMasonry: e.target.value})}
                        className="w-full border-blue-200 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                </div>
                </>
              )}
            </div>
          </div>

          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition">
            {entryToEdit ? 'Update Log' : 'Save Log'}
          </button>
        </form>
        )}

        {mode === 'bulk' && (
        <form onSubmit={handleBulkSubmit} className="p-6 space-y-6">
            <div className="bg-yellow-50 p-4 rounded-lg text-sm text-yellow-800 mb-4">
                <strong>Format:</strong> From | To | Concrete Qty | Masonry Qty (Optional)<br/>
                Copy directly from Excel.<br/>
                System will auto-apply defaults for prior concrete if not specified.
            </div>
            
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Lining Step for Bulk Data</label>
              <select 
                value={bulkStep}
                onChange={e => setBulkStep(e.target.value as ConcreteStep)}
                className="w-full border rounded-lg p-2.5 bg-gray-50 focus:ring-2 focus:ring-blue-500"
              >
                {Object.values(ConcreteStep).filter(s => s !== ConcreteStep.SUM).map(step => (
                  <option key={step} value={step}>{step}</option>
                ))}
              </select>
            </div>

            <textarea 
                className="w-full h-64 p-4 border rounded-lg font-mono text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500"
                placeholder={`0+922\t0+941\t164\t5.2\n0+941\t0+961\t98\t0\n...`}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
            />
             <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition">
                Import Bulk Data
            </button>
        </form>
        )}

        {mode === 'manage' && (
            <div className="p-6 space-y-8">
                <div>
                    <h3 className="text-lg font-bold text-gray-800 mb-2">Export Data</h3>
                    <p className="text-sm text-gray-500 mb-4">Download all logs as a JSON file to share with colleagues or backup your data.</p>
                    <button onClick={handleExport} className="bg-slate-700 text-white px-4 py-2 rounded-lg hover:bg-slate-800 flex items-center space-x-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        <span>Download JSON</span>
                    </button>
                </div>
                <div className="border-t pt-6">
                    <h3 className="text-lg font-bold text-gray-800 mb-2">Import Data</h3>
                    <p className="text-sm text-gray-500 mb-4">Upload a previously exported JSON file. <strong className="text-red-500">Warning: This will overwrite current data.</strong></p>
                    <input 
                        type="file" 
                        accept=".json"
                        ref={fileInputRef}
                        onChange={handleImportFile}
                        className="block w-full text-sm text-slate-500
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-full file:border-0
                        file:text-sm file:font-semibold
                        file:bg-blue-50 file:text-blue-700
                        hover:file:bg-blue-100"
                    />
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default DataEntry;