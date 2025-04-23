import React, { useEffect } from 'react';
import { RevenueEntity, YearlyKPIs } from '../services/api';
import RevenueTable from '../components/RevenueTable';
import useRevenueStore from '../store/revenueStore';

const RevenuePage: React.FC = () => {
  // Use the store for state management
  const {
    selectedYear,
    revenueData,
    kpiData,
    isLoading,
    error,
    setSelectedYear,
    fetchRevenueData,
    fetchKPIData,
    invalidateCache
  } = useRevenueStore();

  // Function to fetch both revenue and KPI data with caching
  const refreshData = async (forceRefresh = false) => {
    console.log(`[RevenuePage] Refreshing data for year: ${selectedYear}, forceRefresh: ${forceRefresh}`);
    try {
      // Use Promise.all to fetch both data types in parallel
      await Promise.all([
        fetchRevenueData(selectedYear, forceRefresh),
        fetchKPIData(selectedYear, forceRefresh)
      ]);
      console.log("[RevenuePage] Data refresh complete.");
    } catch (err) {
      console.error("[RevenuePage] Error during data refresh:", err);
    }
  };

  // Initial data fetch on component mount and when year changes
  useEffect(() => {
    refreshData(false); // Use cache if available
  }, [selectedYear]);

  // Handler for year selection change
  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedYear(parseInt(e.target.value, 10));
  };

  // Handler for KPI updates
  const handleKpiUpdateAndRefresh = async (_updatedKpiData: YearlyKPIs) => {
    // Invalidate KPI cache for the current year
    invalidateCache(selectedYear, 'kpi');
    // Refresh data from API
    await refreshData(true);
  };

  // Calculate total hours for a project in the selected year
  const getYearlyHours = (project: RevenueEntity, year: number): number => {
    const prefix = `${year}-`;
    let totalHours = 0;
    if (project.monthlyHours) {
      for (const monthKey in project.monthlyHours) {
        if (monthKey.startsWith(prefix)) {
          totalHours += project.monthlyHours[monthKey] || 0;
        }
      }
    }
    return totalHours;
  };

  // Generate list of years for the dropdown
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => currentYear - i); // Last 10 years

  return (
    <div className="p-4 md:p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-full mx-auto bg-white shadow-md rounded-lg p-4 md:p-6">
        {/* Header: Title and Controls */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-6 gap-4">
          <h1 className="text-xl md:text-2xl font-semibold text-gray-800">Omzetoverzicht</h1>

          {/* Controls: Year Selector and Sync Button */}
          <div className="flex items-center gap-2 md:gap-3 relative">
            {/* Year Selector */}
            <select
              value={selectedYear}
              onChange={handleYearChange}
              className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              {years.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            {/* Cache Wissen Button */}
            <button
              onClick={() => window.location.href = '/clear-cache.html'}
              className="text-sm bg-gray-500 hover:bg-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition-colors"
            >
              Cache Wissen
            </button>

          </div>
        </div>

        {/* Sync Feedback Message */}
        {/* {syncMessage && (
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
        )} */}

        {/* Fout- en laadstatus */}
        {error && <p className="text-red-500 mb-4">{error}</p>}
        {isLoading && !error && <p className="text-gray-500 mb-4">Gegevens laden...</p>}

        {/* Tabel Container - PASS onRefreshNeeded prop */}
        <div className="w-full overflow-x-auto">
          {!isLoading && !error && revenueData.length > 0 && (
            <RevenueTable
              data={revenueData.filter(project => getYearlyHours(project, selectedYear) > 0)}
              year={selectedYear}
              kpiData={kpiData}
              onKpiUpdate={handleKpiUpdateAndRefresh}
              onRefreshNeeded={refreshData}
            />
          )}
          {!isLoading && !error && revenueData.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-3 py-2 rounded text-sm w-full">
               <p>Geen gegevens gevonden voor {selectedYear}. Probeer een ander jaar of synchroniseer de gegevens eerst.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RevenuePage;