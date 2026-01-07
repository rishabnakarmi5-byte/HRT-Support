import React, { useState, useEffect, useMemo } from 'react';
import { BatchEntry, ConcreteStep, ForecastSummary } from './types';
import { TOTAL_TUNNEL_LENGTH, INITIAL_CHAINAGE_MAP, ROCK_CLASS_DESIGN_DATA } from './constants';
import { calculateDesignQty, calculateUnionLength, mergeRanges } from './utils';
import Dashboard from './components/Dashboard';
import DataEntry from './components/DataEntry';
import Analysis from './components/Analysis';
import Parameters from './components/Parameters';
import Calculations from './components/Calculations';

// Firebase Imports
import { db, auth, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User, AuthError } from 'firebase/auth';
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'entry' | 'analysis' | 'params' | 'calcs'>('dashboard');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // 1. Auth Listener
  useEffect(() => {
    if (!auth) {
        setLoadingAuth(false);
        return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Data Sync Listener (Firestore)
  useEffect(() => {
    if (!user || !db) return;

    // Subscribe to the 'batches' collection
    const q = query(collection(db, "batches"), orderBy("date", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const dbEntries = snapshot.docs.map(doc => ({ 
          ...doc.data(), 
          id: doc.id 
      })) as BatchEntry[];
      
      // Sort in JS as well to be safe or rely on query order
      // We want to process them for display if needed, but data is raw here
      setEntries(dbEntries);
    }, (error) => {
      console.error("Error fetching real-time data:", error);
      alert("Error connecting to database. Do you have permission?");
    });

    return () => unsubscribe();
  }, [user]);

  // Handle Saving (Write to Firestore)
  const handleSave = async (newEntriesData: Omit<BatchEntry, 'id' | 'designedQty'>[], isEdit: boolean = false) => {
    if (!db || !user) return;

    const processed = newEntriesData.map(data => {
      const designStep = data.step === ConcreteStep.GANTRY ? ConcreteStep.SUM : data.step;
      return {
        ...data,
        id: isEdit && editingEntryId ? editingEntryId : crypto.randomUUID(),
        designedQty: calculateDesignQty(data.fromChainage, data.toChainage, designStep)
      };
    });

    try {
        for (const entry of processed) {
            await setDoc(doc(db, "batches", entry.id), entry);
        }
        
        if (isEdit) setEditingEntryId(null);
        setActiveTab('dashboard');
    } catch (e) {
        console.error("Error saving batch:", e);
        alert("Failed to save data. Check your internet connection.");
    }
  };

  const handleImport = async (importedData: BatchEntry[]) => {
      if (!db) return;
      if (confirm('Importing data will add these entries to the cloud database. Continue?')) {
          try {
             for (const entry of importedData) {
                 await setDoc(doc(db, "batches", entry.id), entry);
             }
             alert("Import successful!");
             setActiveTab('dashboard');
          } catch (e) {
             console.error(e);
             alert("Error during import.");
          }
      }
  };

  const deleteEntry = async (id: string) => {
    if (!db) return;
    if (confirm("Are you sure you want to delete this entry?")) {
        try {
            await deleteDoc(doc(db, "batches", id));
        } catch (e) {
            console.error(e);
            alert("Failed to delete.");
        }
    }
  };

  const handleLogin = async () => {
     if (!auth) return;
     try {
        await signInWithPopup(auth, googleProvider);
     } catch (error) {
        const authError = error as AuthError;
        console.error("Login failed", authError);
        if (authError.code === 'auth/unauthorized-domain') {
            alert(`Configuration Error: Unauthorized Domain.\n\nThe domain "${window.location.hostname}" is not authorized for this Firebase project.\n\nPlease go to the Firebase Console > Authentication > Settings > Authorized Domains and add this domain.`);
        } else if (authError.code === 'auth/popup-closed-by-user') {
            // User closed popup, no need to alert
        } else {
            alert(`Login Failed: ${authError.message}`);
        }
     }
  };

  const handleLogout = () => {
     if (auth) signOut(auth);
  };

  // --- Calculations (Same as before) ---
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

  const totalProjectDesignVolume = useMemo(() => {
    return INITIAL_CHAINAGE_MAP.reduce((acc, seg) => {
      const segLen = seg.to - seg.from;
      return acc + (segLen * ROCK_CLASS_DESIGN_DATA[seg.rockClass].total);
    }, 0);
  }, []);

  const totals = useMemo(() => {
    const gantryEntries = entries.filter(e => e.step === ConcreteStep.GANTRY);
    const totalActualPoured = gantryEntries.length > 0 
      ? gantryEntries.reduce((acc, curr) => acc + (curr.cumulativeActualQty || curr.actualQty), 0)
      : entries.reduce((acc, curr) => acc + curr.actualQty, 0);
    
    const totalDesignedSum = entries.reduce((acc, curr) => acc + curr.designedQty, 0);
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
    const gantryEntries = entries.filter(e => e.step === ConcreteStep.GANTRY);
    const intervals = gantryEntries.map(e => ({
      start: Math.min(e.fromChainage, e.toChainage),
      end: Math.max(e.fromChainage, e.toChainage)
    }));
    const mergedRanges = mergeRanges(intervals);
    
    let completedDesign = 0;
    mergedRanges.forEach(range => {
        completedDesign += calculateDesignQty(range.start, range.end, ConcreteStep.SUM);
    });

    const completedActual = totals.actual;
    const remainingDesign = Math.max(0, totalProjectDesignVolume - completedDesign);
    let currentOverbreakRate = 1.05;
    if (completedDesign > 0) {
        currentOverbreakRate = completedActual / completedDesign;
    }
    const safeRate = Math.max(0.8, Math.min(currentOverbreakRate, 2.0));
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

  // --- Rendering ---

  // 1. Loading State
  if (loadingAuth) {
      return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Loading Application...</div>;
  }

  // 2. Setup Required State (Missing Config)
  if (!auth) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
              <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full border border-red-200">
                  <h2 className="text-2xl font-bold text-red-600 mb-4">Setup Required</h2>
                  <p className="text-gray-600 mb-4">To enable shared data and logging in, you must connect this app to Firebase.</p>
                  <div className="bg-gray-50 p-4 rounded text-xs font-mono mb-4 text-gray-700 overflow-x-auto">
                      VITE_FIREBASE_API_KEY=...<br/>
                      VITE_FIREBASE_AUTH_DOMAIN=...<br/>
                      VITE_FIREBASE_PROJECT_ID=...<br/>
                      ...
                  </div>
                  <p className="text-sm text-gray-500">Add these to your <code>.env</code> file or Netlify Environment Variables.</p>
              </div>
          </div>
      );
  }

  // 3. Login State
  if (!user) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 p-4">
             <div className="bg-white p-10 rounded-2xl shadow-2xl max-w-sm w-full text-center">
                 <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                 </div>
                 <h1 className="text-2xl font-bold text-gray-800 mb-2">HRT Concrete Tracker</h1>
                 <p className="text-gray-500 mb-8 text-sm">Sign in to access shared data logs.</p>
                 
                 <button 
                    onClick={handleLogin}
                    className="w-full flex items-center justify-center bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-3 px-4 rounded-xl transition shadow-sm"
                 >
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 mr-3" />
                    Sign in with Google
                 </button>
                 <p className="mt-4 text-[10px] text-gray-400">If login fails with "Unauthorized Domain", check your Firebase Console settings.</p>
             </div>
        </div>
      );
  }

  // 4. Main App State
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
            <div>
                <h1 className="text-xl font-bold tracking-tight">HRT Concrete Tracker</h1>
                <p className="text-[10px] text-slate-400 font-mono hidden md:block">User: {user.email}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
              <nav className="hidden md:flex space-x-1 bg-slate-800 p-1 rounded-md">
                <button onClick={() => handleTabChange('dashboard')} className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>Dashboard</button>
                <button onClick={() => handleTabChange('entry')} className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'entry' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>Log Batch</button>
                <button onClick={() => handleTabChange('analysis')} className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'analysis' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>Analysis</button>
                <button onClick={() => handleTabChange('calcs')} className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'calcs' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>Logic</button>
                <button onClick={() => handleTabChange('params')} className={`px-4 py-1.5 rounded text-sm font-medium transition ${activeTab === 'params' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>Check Values</button>
              </nav>
              <button onClick={handleLogout} className="text-slate-400 hover:text-white text-sm" title="Sign Out">
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
          </div>
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