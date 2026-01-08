
import React, { useState } from 'react';
import { ROCK_CLASS_DESIGN_DATA, DEFAULT_RATES, INITIAL_CHAINAGE_MAP, EXCAVATION_DATA } from '../constants';
import { SurveyPoint } from '../types';
import { parseChainage } from '../utils';

interface ParametersProps {
    surveyOverrides?: SurveyPoint[];
    onAddSurvey?: (points: Omit<SurveyPoint, 'id'>[]) => void;
    onDeleteSurvey?: (id: string) => void;
}

const Parameters: React.FC<ParametersProps> = ({ surveyOverrides = [], onAddSurvey, onDeleteSurvey }) => {
  const [surveyText, setSurveyText] = useState('');

  const handleSurveySubmit = () => {
      if (!onAddSurvey || !surveyText.trim()) return;
      const lines = surveyText.trim().split('\n');
      const points: Omit<SurveyPoint, 'id'>[] = [];
      
      lines.forEach(line => {
          // Expected: Chainage | Area
          const parts = line.split(/[\t,]+| {2,}/).map(s => s.trim()).filter(s => s);
          if (parts.length >= 2) {
              const ch = parseChainage(parts[0]);
              const area = parseFloat(parts[1]);
              if (!isNaN(ch) && !isNaN(area)) {
                  points.push({
                      chainage: ch,
                      area: area,
                      dateAdded: new Date().toISOString()
                  });
              }
          }
      });

      if (points.length > 0) {
          onAddSurvey(points);
          setSurveyText('');
      } else {
          alert('No valid data found. Format: Chainage <tab> Area');
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-4">
        <h2 className="text-xl font-bold text-slate-800">System Parameters & Constants</h2>
      </div>

      {/* 1. Re-Survey Data Management */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm border-l-4 border-l-purple-500">
          <h3 className="text-lg font-bold mb-2 text-slate-800">Re-Survey / Excavation Profile Updates</h3>
          <p className="text-sm text-gray-500 mb-4">
              Add new survey points here (Chainage & Excavated Area). 
              <br/><strong>Note:</strong> Data entered here will override the original PDF data. 
              The system assumes these areas represent the "Outer Line to be Concreted" (including any shotcrete), 
              so <span className="font-bold text-purple-700">Shotcrete Deduction will be disabled</span> for these sections.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                  <label className="text-xs font-bold text-gray-700 uppercase mb-1 block">Add New Points (Bulk)</label>
                  <textarea 
                      className="w-full h-32 p-3 border rounded text-sm font-mono focus:ring-2 focus:ring-purple-500"
                      placeholder={`1210.5\t32.5\n1215.0\t31.8\n...`}
                      value={surveyText}
                      onChange={e => setSurveyText(e.target.value)}
                  />
                  <button 
                    onClick={handleSurveySubmit}
                    className="mt-2 bg-purple-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-purple-700 transition"
                  >
                      Add Survey Points
                  </button>
              </div>
              <div className="h-48 overflow-y-auto border rounded bg-gray-50 p-2 custom-scrollbar">
                  <table className="w-full text-xs text-left">
                      <thead className="text-gray-500 font-bold border-b">
                          <tr>
                              <th className="p-2">Chainage</th>
                              <th className="p-2">New Area (m²)</th>
                              <th className="p-2"></th>
                          </tr>
                      </thead>
                      <tbody>
                          {surveyOverrides.length === 0 && (
                              <tr><td colSpan={3} className="p-4 text-center text-gray-400 italic">No overrides added.</td></tr>
                          )}
                          {surveyOverrides.sort((a,b) => a.chainage - b.chainage).map(p => (
                              <tr key={p.id} className="hover:bg-gray-100">
                                  <td className="p-2 font-mono">{p.chainage.toFixed(2)}</td>
                                  <td className="p-2 font-mono font-bold text-purple-700">{p.area.toFixed(2)}</td>
                                  <td className="p-2 text-right">
                                      <button onClick={() => onDeleteSurvey && onDeleteSurvey(p.id)} className="text-red-400 hover:text-red-600">
                                          &times;
                                      </button>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      </div>

      {/* Design Constants */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="text-lg font-bold mb-4 text-slate-800 border-b pb-2">Theoretical Design Constants (m³/m)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 font-bold text-gray-600 border-b">
              <tr>
                <th className="px-4 py-2">Rock Class</th>
                <th className="px-4 py-2">Invert</th>
                <th className="px-4 py-2">Kicker</th>
                <th className="px-4 py-2">Gantry</th>
                <th className="px-4 py-2 text-blue-700">Total Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {Object.entries(ROCK_CLASS_DESIGN_DATA).map(([cls, data]) => (
                <tr key={cls}>
                  <td className="px-4 py-3 font-bold">{cls}</td>
                  <td className="px-4 py-3 text-gray-600">{data.invert.toFixed(3)}</td>
                  <td className="px-4 py-3 text-gray-600">{data.kicker.toFixed(3)}</td>
                  <td className="px-4 py-3 text-gray-600">{data.gantry.toFixed(3)}</td>
                  <td className="px-4 py-3 font-mono font-bold text-blue-700 bg-blue-50">{data.total.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deductions & Rates */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-full">
          <h3 className="text-lg font-bold mb-4 text-slate-800 border-b pb-2">Rates & Deductions</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-semibold text-gray-600">Shotcrete Deduction</span>
              <span className="font-mono font-bold text-slate-800">{DEFAULT_RATES.SHOTCRETE_DEDUCTION} m³/m</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-600">Stone Masonry Area</span>
                <span className="text-[10px] text-gray-400">Applied after {DEFAULT_RATES.MASONRY_CUTOFF_DATE}</span>
              </div>
              <span className="font-mono font-bold text-slate-800">{DEFAULT_RATES.STONE_MASONRY_AREA} m²</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-600">Finished Profile Area (Air Void)</span>
                <span className="text-[10px] text-gray-400">Subtracted from Excavated Area</span>
              </div>
              <span className="font-mono font-bold text-slate-800">{DEFAULT_RATES.FINISHED_INNER_AREA} m²</span>
            </div>
          </div>
        </div>

        {/* Chainage Map */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-full">
           <h3 className="text-lg font-bold mb-4 text-slate-800 border-b pb-2">Geological Chainage Map</h3>
           <div className="h-64 overflow-y-auto pr-2 custom-scrollbar">
             <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 font-bold text-gray-600 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2">From</th>
                    <th className="px-2 py-2">To</th>
                    <th className="px-2 py-2">Class</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {INITIAL_CHAINAGE_MAP.map((seg, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-2 py-2 font-mono">{seg.from.toFixed(1)}</td>
                      <td className="px-2 py-2 font-mono">{seg.to.toFixed(1)}</td>
                      <td className="px-2 py-2 font-bold text-gray-700">{seg.rockClass}</td>
                    </tr>
                  ))}
                </tbody>
             </table>
           </div>
        </div>
      </div>
      
       {/* Excavation Data Sample */}
       <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="text-lg font-bold mb-4 text-slate-800 border-b pb-2">Original Excavation Profile Areas</h3>
        <p className="text-xs text-gray-500 mb-3">
          This data is used to calculate the "Gross Excavated Volume" by interpolating the area between chainages.
        </p>
        <div className="h-60 overflow-y-auto border rounded-lg custom-scrollbar">
            <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 font-bold text-gray-600 border-b sticky top-0">
              <tr>
                <th className="px-4 py-2">Chainage (m)</th>
                <th className="px-4 py-2">Excavated Area (m²)</th>
                <th className="px-4 py-2">Rock Class</th>
              </tr>
            </thead>
            <tbody className="divide-y">
                {EXCAVATION_DATA.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-1 font-mono text-gray-700">{row.chainage}</td>
                        <td className="px-4 py-1 font-mono">{row.area}</td>
                        <td className="px-4 py-1 text-gray-500">{row.rockClass}</td>
                    </tr>
                ))}
            </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};
export default Parameters;