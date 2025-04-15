import React, { useState, useEffect } from 'react';
import { RevenueEntity, getRevenueDataByYear, YearlyKPIs, getKPIDataByYear, syncAllData, syncHoursForYear, syncProjectsOnly, syncOffersOnly, syncRecentHours } from '../services/api';
import RevenueTable from '../components/RevenueTable';
import { Button } from '@/components/ui/button';

interface RevenuePageProps {
  onSyncClick?: () => void; // Optional because we'll handle sync directly here
}

const RevenuePage: React.FC<RevenuePageProps> = ({ onSyncClick }) => {
  const [revenueData, setRevenueData] = useState<RevenueEntity[]>([]);
  const [kpiData, setKpiData] = useState<YearlyKPIs | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [syncDropdownOpen, setSyncDropdownOpen] = useState<boolean>(false);
  const [syncInProgress, setSyncInProgress] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  
  // State voor jaar selectie
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const availableYears = [currentYear - 1, currentYear, currentYear + 1];
  
  // Huidige datum voor weergave
  const currentDate = new Date().toLocaleDateString('nl-NL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  // --- NEW: Function to fetch/refresh all data ---
  const refreshData = async () => {
    console.log(`[RevenuePage] Refreshing data for year: ${selectedYear}`);
    try {
      setIsLoading(true);
      setError(null);
      
      // Parallelle data-aanroepen
      const [revenueResponse, kpiResponse] = await Promise.all([
        getRevenueDataByYear(selectedYear),
        getKPIDataByYear(selectedYear).catch(err => {
          console.warn('Error fetching KPI data, using empty set:', err);
          return {
            year: selectedYear,
            months: []
          };
        })
      ]);
      
      setRevenueData(revenueResponse);
      setKpiData(kpiResponse);
      console.log("[RevenuePage] Data refresh complete.");
      
    } catch (err) {
      console.error('Error refreshing data:', err);
      setError('Er is een fout opgetreden bij het ophalen van de gegevens.');
    } finally {
      setIsLoading(false);
    }
  };

  // Ophalen van data wanneer jaar verandert of refresh nodig is
  useEffect(() => {
    refreshData(); // Call the refresh function
  }, [selectedYear]); // Dependency remains selectedYear

  // Handler voor jaar wijziging
  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedYear(parseInt(e.target.value, 10));
  };

  // Handler voor bijwerken van KPI waardes - NOW ALSO REFRESHES DATA
  const handleKpiUpdateAndRefresh = async (updatedKpiData: YearlyKPIs) => {
    console.log("[RevenuePage] KPI data updated locally, triggering full refresh...");
    setKpiData(updatedKpiData); // Update local state immediately for responsiveness
    await refreshData(); // Trigger full data refresh
  };

  // Helper function to calculate total hours for a project in a given year
  const getYearlyHours = (project: RevenueEntity, year: number): number => {
    if (!project.monthlyHours) {
      return 0;
    }
    const yearPrefix = `${year}-`;
    let totalHours = 0;
    for (const monthKey in project.monthlyHours) {
      if (monthKey.startsWith(yearPrefix)) {
        totalHours += project.monthlyHours[monthKey] || 0;
      }
    }
    return totalHours;
  };
  
  // Sync handlers
  const handleSync = async (syncType: 'all' | 'projects' | 'offers' | 'hours' | 'recent-hours') => {
    try {
      setSyncInProgress(true);
      setSyncMessage('Synchronisatie gestart...');
      setSyncDropdownOpen(false);
      
      let response;
      switch (syncType) {
        case 'all':
          response = await syncAllData();
          break;
        case 'projects':
          response = await syncProjectsOnly();
          break;
        case 'offers':
          response = await syncOffersOnly();
          break;
        case 'hours':
          response = await syncHoursForYear(selectedYear);
          break;
        case 'recent-hours':
          response = await syncRecentHours();
          break;
      }
      
      // Toon bericht en refresh data
      setSyncMessage(`Synchronisatie voltooid: ${response.message}`);
      
      // Haal verse data op
      const freshData = await getRevenueDataByYear(selectedYear);
      setRevenueData(freshData);
      
      // Geef callback door als die er is
      if (onSyncClick) {
        onSyncClick();
      }
      
    } catch (err) {
      console.error('Sync error:', err);
      setSyncMessage('Fout bij synchroniseren. Probeer het later opnieuw.');
    } finally {
      // Zet syncInProgress terug na 1 seconde zodat gebruiker het resultaat kan zien
      setTimeout(() => {
        setSyncInProgress(false);
      }, 1000);
      
      // Verwijder het bericht na 5 seconden
      setTimeout(() => {
        setSyncMessage(null);
      }, 5000);
    }
  };

  return (
    <div style={{
      width: "100%",
      maxWidth: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      position: "relative",
      padding: "0 8px"
    }}>
      {/* Huidige datum weergave */}
      <div style={{
        position: "absolute",
        top: "0",
        right: "16px",
        fontSize: "12px",
        color: "#71717a",
        backgroundColor: "#f4f4f5",
        padding: "4px 8px",
        borderRadius: "4px",
        zIndex: 10
      }}>
        Systeemtijd: {currentDate}
      </div>
      
      <div style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: "1400px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center"
      }}>
        <h1 className="text-lg font-semibold mb-3">Omzet per Project - {selectedYear}</h1>
        <p className="text-xs text-gray-500 mb-3">Overzicht van de verwachte omzet per project, gebaseerd op geschreven uren</p>
        
        {/* Controls Row */}
        <div className="flex items-center justify-between mb-4 w-full">
          <div className="flex items-center gap-2">
            <span className="text-sm">Jaar:</span>
            <select 
              value={selectedYear}
              onChange={handleYearChange}
              className="border border-gray-200 rounded px-3 py-1 text-sm"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          
          {/* Synchronisatie Dropdown - FIXED STYLING */}
          <div className="relative">
            <Button 
              onClick={() => setSyncDropdownOpen(!syncDropdownOpen)}
              variant="default"
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-sm font-medium rounded flex items-center gap-1 shadow-sm"
              disabled={syncInProgress}
            >
              {syncInProgress ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Synchroniseren...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                  </svg>
                  <span>Synchroniseren</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </>
              )}
            </Button>
            
            {/* Compact Dropdown Menu */}
            {syncDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white shadow-md rounded border border-gray-200 w-48 z-20">
                <div className="p-1.5 text-xs font-medium text-gray-700 border-b bg-gray-50">
                  Synchronisatie opties
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <button 
                    onClick={() => handleSync('all')}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 border-b flex items-center gap-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    Alles synchroniseren
                  </button>
                  <button 
                    onClick={() => handleSync('projects')}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 border-b flex items-center gap-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm11 1H6v8l4-2 4 2V6z" clipRule="evenodd" />
                    </svg>
                    Alleen projecten
                  </button>
                  <button 
                    onClick={() => handleSync('offers')}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 border-b flex items-center gap-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                    </svg>
                    Alleen offertes
                  </button>
                  <button 
                    onClick={() => handleSync('hours')}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 border-b flex items-center gap-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                    </svg>
                    Uren voor {selectedYear}
                  </button>
                  <button 
                    onClick={() => handleSync('recent-hours')}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                    </svg>
                    Recente uren (3 mnd)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Sync Feedback Message */}
        {syncMessage && (
          <div className={`mb-4 px-4 py-3 text-sm rounded-md border w-full flex items-center gap-2 ${
            syncMessage.includes('Fout') 
              ? 'bg-red-50 border-red-200 text-red-700' 
              : 'bg-green-50 border-green-200 text-green-700'
          }`}>
            {syncMessage.includes('Fout') ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
            {syncMessage}
          </div>
        )}

        {/* Fout- en laadstatus */}
        {error && <p className="text-red-500 mb-4">{error}</p>}
        {isLoading && !error && <p className="text-gray-500 mb-4">Gegevens laden...</p>}
        {syncMessage && <p className="text-sm text-blue-600 mb-4 font-medium">{syncMessage}</p>}

        {/* Tabel Container - PASS onRefreshNeeded prop */}
        <div className="w-full overflow-x-auto"> 
          {!isLoading && !error && revenueData.length > 0 && (
            <RevenueTable 
              data={revenueData.filter(project => getYearlyHours(project, selectedYear) > 0)} 
              year={selectedYear}
              kpiData={kpiData}
              onKpiUpdate={handleKpiUpdateAndRefresh} // Pass the combined handler
              onRefreshNeeded={refreshData} // Pass the refresh function
            />
          )}
          {!isLoading && !error && revenueData.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-3 py-2 rounded text-sm w-full">
               <p>Geen gegevens gevonden voor {selectedYear}. Probeer een ander jaar of synchroniseer de gegevens eerst.</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Sluit dropdown als er ergens anders geklikt wordt */}
      {syncDropdownOpen && (
        <div 
          className="fixed inset-0 z-10" 
          onClick={() => setSyncDropdownOpen(false)}
        ></div>
      )}
    </div>
  );
};

export default RevenuePage; 