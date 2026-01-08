
import React, { useMemo } from 'react';
import { BatchEntry, ConcreteStep, ForecastSummary } from '../types';
import { calculateDesignQty, formatChainage } from '../utils';
import { DEFAULT_RATES } from '../constants';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush, Line, ComposedChart, Area, LineChart, BarChart, Bar
} from 'recharts';

interface AnalysisProps {
  entries: BatchEntry[];
  totalLength: number;
  forecast?: ForecastSummary;
}

const Analysis: React.FC<AnalysisProps> = ({ entries, totalLength, forecast }) => {
  const gantryEntries = useMemo(() => {
    return entries
      .filter(e => e.step === ConcreteStep.GANTRY)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [entries]);

  // 1. Spatial Data (Consumption Profile & Over-consumption)
  const spatialData = useMemo(() => {
    const data = gantryEntries.map(e => {
      const len = Math.abs(e.toChainage - e.fromChainage);
      const mid = (e.fromChainage + e.toChainage) / 2;
      
      const designQty = calculateDesignQty(e.fromChainage, e.toChainage, ConcreteStep.SUM);
      
      const designRate = len > 0 ? designQty / len : 0;
      const actualRate = len > 0 ? (e.cumulativeActualQty || e.actualQty) / len : 0;
      
      // Percentage over theoretical design: (Actual - Design) / Design * 100
      const overConsumption = designRate > 0 
        ? ((actualRate - designRate) / designRate) * 100 
        : 0;

      return {
        chainage: mid,
        chainageDisplay: formatChainage(mid),
        len,
        designRate: parseFloat(designRate.toFixed(2)),
        actualRate: parseFloat(actualRate.toFixed(2)),
        overConsumption: parseFloat(overConsumption.toFixed(1))
      };
    });

    return data.sort((a, b) => a.chainage - b.chainage);
  }, [gantryEntries, totalLength]);

  // 2. Cumulative Projection Data
  const projectionData = useMemo(() => {
    if (!forecast) return [];

    const points: any[] = [];
    
    // Start Point
    points.push({
      length: 0,
      cumActual: 0,
      cumDesign: 0,
      projected: 0,
      label: 'Start'
    });

    let runningLen = 0;
    let runningActual = 0;
    let runningDesign = 0;

    gantryEntries.forEach(e => {
        const len = Math.abs(e.toChainage - e.fromChainage);
        const act = e.cumulativeActualQty || e.actualQty;
        const des = calculateDesignQty(e.fromChainage, e.toChainage, ConcreteStep.SUM);

        runningLen += len;
        runningActual += act;
        runningDesign += des;

        points.push({
            length: parseFloat(runningLen.toFixed(1)),
            cumActual: parseFloat(runningActual.toFixed(1)),
            cumDesign: parseFloat(runningDesign.toFixed(1)),
            projected: parseFloat(runningActual.toFixed(1)),
            label: `${formatChainage(e.fromChainage)} - ${formatChainage(e.toChainage)}`
        });
    });

    // Final Project Target Point
    points.push({
        length: totalLength,
        cumActual: null,
        cumDesign: parseFloat(forecast.totalProjectScope.toFixed(0)),
        projected: parseFloat(forecast.projectedGrandTotal.toFixed(0)),
        label: 'Project Completion'
    });

    return points;
  }, [gantryEntries, totalLength, forecast]);

  // 3. Masonry Savings Data
  const masonryAnalysis = useMemo(() => {
    let totalVolume = 0;
    const distribution: any[] = [];
    
    // Sort all entries spatially to plot along chainage
    const sorted = [...entries].sort((a, b) => Math.min(a.fromChainage, a.toChainage) - Math.min(b.fromChainage, b.toChainage));

    sorted.forEach(e => {
        let vol = 0;
        // Use specific quantity if available, else calc from legacy boolean
        if (e.stoneMasonryQty !== undefined) {
            vol = e.stoneMasonryQty;
        } else if (e.hasMasonryDeduction) {
            const len = Math.abs(e.toChainage - e.fromChainage);
            vol = len * DEFAULT_RATES.STONE_MASONRY_AREA;
        }

        if (vol > 0) {
            totalVolume += vol;
            distribution.push({
                chainage: (e.fromChainage + e.toChainage) / 2,
                vol: parseFloat(vol.toFixed(2)),
                label: `${formatChainage(e.fromChainage)}-${formatChainage(e.toChainage)}`,
                date: e.date
            });
        }
    });

    return { totalVolume, distribution };
  }, [entries]);

  if (gantryEntries.length === 0 && masonryAnalysis.distribution.length === 0) {
      return <div className="p-10 text-center text-gray-500">No data available. Add entries to view analysis.</div>;
  }

  return (
    <div className="space-y-8">
      
      {/* 1. Cumulative Projection (Main Chart) */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="text-lg font-bold mb-2 text-gray-800">Projected Concrete Consumption</h3>
        <p className="text-xs text-gray-500 mb-6">
            Cumulative Volume vs <span className="font-bold">Total Length Completed</span>. 
            Reflects actual construction sequence (upstream/downstream).
        </p>
        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart 
              data={projectionData} 
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="length" 
                type="number" 
                unit="m" 
                domain={[0, totalLength]} 
                tickCount={10} 
                label={{ value: 'Length Completed (m)', position: 'insideBottomRight', offset: -5 }}
              />
              <YAxis unit="m³" width={80} />
              <Tooltip 
                labelFormatter={(v) => `Length: ${Number(v).toFixed(1)}m`}
                content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        return (
                            <div className="bg-white p-3 border shadow-lg text-xs rounded z-50">
                                <p className="font-bold mb-1">Completed: {d.length}m</p>
                                {d.label !== 'Start' && d.label !== 'Project Completion' && (
                                    <p className="text-gray-500 mb-2 italic">{d.label}</p>
                                )}
                                <div className="space-y-1">
                                    {d.cumActual !== null && (
                                        <p className="text-blue-600">Actual: {d.cumActual} m³</p>
                                    )}
                                    <p className="text-gray-500">Design: {d.cumDesign} m³</p>
                                    {d.length === totalLength && (
                                        <p className="text-red-500 font-bold">Projected: {d.projected} m³</p>
                                    )}
                                </div>
                            </div>
                        );
                    }
                    return null;
                }}
              />
              <Legend verticalAlign="top" height={36} />
              <Line 
                type="monotone" 
                dataKey="cumDesign" 
                name="Design Cumulative" 
                stroke="#9ca3af" 
                strokeWidth={2} 
                dot={false} 
                activeDot={false}
              />
              <Line 
                type="monotone" 
                dataKey="projected" 
                name="Projected Path" 
                stroke="#ef4444" 
                strokeWidth={2} 
                strokeDasharray="5 5" 
                dot={false} 
                activeDot={false}
              />
              <Area 
                type="monotone" 
                dataKey="cumActual" 
                name="Actual Cumulative" 
                fill="rgba(59, 130, 246, 0.2)" 
                stroke="#3b82f6" 
                strokeWidth={3} 
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 2. Over-consumption Percentage Distribution */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="text-lg font-bold mb-2 text-gray-800">Over-consumption %</h3>
            <p className="text-xs text-gray-500 mb-6">Percentage over theoretical design by Chainage.</p>
            <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart 
                data={spatialData} 
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="chainage" type="number" unit="m" domain={[0, totalLength]} tickCount={6} />
                <YAxis unit="%" width={40} />
                <Tooltip 
                    cursor={{fill: 'rgba(0,0,0,0.05)'}}
                    content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            if (d.len === 0) return null;
                            return (
                                <div className="bg-white p-2 border shadow-lg text-xs rounded">
                                    <p className="font-bold">Ch: {d.chainageDisplay}</p>
                                    <p className="text-red-600">Over-consumption: {d.overConsumption}%</p>
                                </div>
                            );
                        }
                        return null;
                    }}
                />
                <Line 
                    type="monotone" 
                    dataKey="overConsumption" 
                    stroke="#ef4444" 
                    strokeWidth={2} 
                    dot={{r: 2, fill: '#ef4444'}} 
                    activeDot={{r: 4}} 
                />
                </LineChart>
            </ResponsiveContainer>
            </div>
        </div>

        {/* 3. Stone Masonry Savings Analysis */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col">
             <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-800">Stone Masonry Savings</h3>
                    <p className="text-xs text-gray-500">Concrete volume saved by masonry deductions.</p>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-bold text-emerald-600">{masonryAnalysis.totalVolume.toFixed(2)} <span className="text-sm text-emerald-400">m³</span></p>
                    <p className="text-[10px] uppercase font-bold text-gray-400">Total Saved</p>
                </div>
             </div>

             <div className="flex-grow min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={masonryAnalysis.distribution} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="chainage" type="number" unit="m" domain={[0, totalLength]} tickCount={6} />
                        <YAxis unit="m³" width={40} />
                        <Tooltip 
                            cursor={{fill: 'rgba(16, 185, 129, 0.1)'}}
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const d = payload[0].payload;
                                    return (
                                        <div className="bg-white p-2 border shadow-lg text-xs rounded border-emerald-200">
                                            <p className="font-bold text-gray-700">{d.label}</p>
                                            <p className="text-emerald-600 font-bold">Saved: {d.vol} m³</p>
                                            <p className="text-[10px] text-gray-400">{d.date}</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Bar dataKey="vol" fill="#10b981" name="Saved Volume" />
                    </BarChart>
                </ResponsiveContainer>
             </div>
        </div>
      </div>

      {/* 4. Detailed Consumption Profile */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="text-lg font-bold mb-2 text-gray-800">Consumption Profile (m³/m)</h3>
        <p className="text-xs text-gray-500 mb-6">
            Localized consumption rate per meter plotted by Chainage.
        </p>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart 
              data={spatialData} 
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="chainage" type="number" unit="m" domain={[0, totalLength]} tickCount={12} />
              <YAxis label={{ value: 'm³/m', angle: -90, position: 'insideLeft' }} />
              <Tooltip 
                 cursor={{fill: 'rgba(0,0,0,0.05)'}}
                 content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        if (d.len === 0) return null;
                        return (
                            <div className="bg-white p-2 border shadow-lg text-xs rounded">
                                <p className="font-bold">Ch: {d.chainageDisplay}</p>
                                <p className="text-blue-600">Actual: {d.actualRate} m³/m</p>
                                <p className="text-gray-500">Design: {d.designRate} m³/m</p>
                            </div>
                        );
                    }
                    return null;
                 }}
              />
              <Legend verticalAlign="top" height={36}/>
              <Line type="monotone" dataKey="actualRate" name="Actual Rate" stroke="#3b82f6" strokeWidth={2} dot={{r: 2}} activeDot={{r: 4}} />
              <Line type="monotone" dataKey="designRate" name="Design Rate" stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 5" dot={{r: 2}} />
              <Brush dataKey="chainage" height={30} stroke="#8884d8" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
};

export default Analysis;