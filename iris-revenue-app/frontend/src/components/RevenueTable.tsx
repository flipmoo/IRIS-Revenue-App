import React, { useState } from 'react';
import {
  RevenueEntity, 
  YearlyKPIs, 
  updateKPIValue, 
  updatePreviousYearConsumption
} from '../services/api';
// Use the alias path if available
import { Button } from '@/components/ui/button';

interface RevenueTableProps {
  data: RevenueEntity[];
  year: number;
  kpiData: YearlyKPIs | null;
  onKpiUpdate: (updatedKpiData: YearlyKPIs) => Promise<void>;
  onRefreshNeeded: () => Promise<void>;
}

// ViewMode typedefinitie
type ViewMode = 'hours' | 'revenue';

// Sorteerrichting
type SortDirection = 'asc' | 'desc';

// Functie om te checken of een entiteit data heeft voor het jaar
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const entityHasDataForYear = (_entity: RevenueEntity, _viewMode: ViewMode): boolean => {
    // TEMPORARY FIX: Always return true to show all projects until revenue logic is complete
    return true; 
    
    /* Original filtering logic:
    const monthlyData = viewMode === 'hours' ? entity.monthlyHours : entity.monthlyRevenue;
    if (!monthlyData) {
        return false;
    }
    const totalForYear = Object.values(monthlyData).reduce((sum, value) => sum + (value || 0), 0);
    // Only filter if total is exactly 0, allow negative revenue for example
    return totalForYear > 0;
    */
};

const RevenueTable: React.FC<RevenueTableProps> = ({ data, year, kpiData, onKpiUpdate, onRefreshNeeded }) => {
  // State voor weergave mode (uren/euro's) - DEFAULT NAAR OMZET
  const [viewMode, setViewMode] = useState<ViewMode>('revenue');
  
  // State voor sorteren
  const [sortColumn, setSortColumn] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // State voor filter op sync-status
  const [syncFilter, setSyncFilter] = useState<'all' | 'synced' | 'unsynced' | 'pending'>('all');
  
  // State voor het bewerken van KPI waarden
  const [editingKpi, setEditingKpi] = useState<{month: string, field: 'targetRevenue' | 'finalRevenue'} | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  
  // State for editing previous year consumption
  const [editingConsumption, setEditingConsumption] = useState<{ projectId: number, targetYear: number } | null>(null);
  const [consumptionEditValue, setConsumptionEditValue] = useState<string>('');
  
  // Format maandnamen voor kolomheaders
  const monthNames = [
    'jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 
    'jul', 'aug', 'sep', 'okt', 'nov', 'dec'
  ];
  
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
    .map(month => `${year}-${month}`);
  
  // Sorteer de data
  const sortData = (dataToSort: RevenueEntity[]): RevenueEntity[] => {
    return [...dataToSort].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;
      
      // Bepaal waarden op basis van sortColumn
      switch (sortColumn) {
        case 'company':
          aValue = a.companyName || '';
          bValue = b.companyName || '';
          break;
        case 'name':
          aValue = a.name || '';
          bValue = b.name || '';
          break;
        case 'type':
          aValue = a.type || '';
          bValue = b.type || '';
          break;
        case 'budget':
          aValue = a.totalexclvat || 0;
          bValue = b.totalexclvat || 0;
          break;
        case 'previousYearBudget':
          aValue = a.previousYearBudgetUsed || 0;
          bValue = b.previousYearBudgetUsed || 0;
          break;
        case 'remaining':
          aValue = a.remainingBudget || 0;
          bValue = b.remainingBudget || 0;
          break;
        default:
          // Check of het een maand is (bijv. '2025-01')
          if (months.includes(sortColumn)) {
            const aMonthData = viewMode === 'hours' 
              ? a.monthlyHours?.[sortColumn] || 0 
              : a.monthlyRevenue?.[sortColumn] || 0;
            
            const bMonthData = viewMode === 'hours' 
              ? b.monthlyHours?.[sortColumn] || 0 
              : b.monthlyRevenue?.[sortColumn] || 0;
            
            aValue = aMonthData;
            bValue = bMonthData;
          } else {
            // Fallback naar naam sortering
            aValue = a.name || '';
            bValue = b.name || '';
          }
      }
      
      // Sorteer op basis van waarde type
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue) 
          : bValue.localeCompare(aValue);
      } else {
        // Numerieke sortering
        return sortDirection === 'asc' 
          ? (aValue as number) - (bValue as number)
          : (bValue as number) - (aValue as number);
      }
    });
  };

  // Filter de data
  const getFilteredData = (): RevenueEntity[] => {
    let filtered = data.filter(entity => entityHasDataForYear(entity, viewMode));
    
    // Filter op sync status als niet 'all'
    if (syncFilter !== 'all') {
      filtered = filtered.filter(entity => entity.syncStatus === syncFilter);
    }
    
    return sortData(filtered);
  };

  const filteredData = getFilteredData();

  if (!filteredData || filteredData.length === 0) {
    return (
        <div className="bg-white border border-gray-200 rounded p-4 text-center text-sm text-gray-500 mt-4">
            Geen data beschikbaar voor de geselecteerde weergave ({viewMode}) en periode.
        </div>
    );
  }

  // Bereken totalen per maand voor projecten
  const monthlyTotals = months.reduce((acc, month) => {
    acc[month] = filteredData.reduce((sum, entity) => 
      sum + (viewMode === 'hours' 
        ? (entity.monthlyHours?.[month] || 0) 
        : (entity.monthlyRevenue?.[month] || 0)), 
    0);
    return acc;
  }, {} as {[month: string]: number});

  // Bereken totaal voor alle projecten en maanden
  const grandTotal = Object.values(monthlyTotals).reduce((sum, value) => sum + value, 0);

  // Bereken restant totaal
  const totalRemaining = filteredData.reduce((sum, entity) => sum + (entity.remainingBudget || 0), 0);

  // Helper voor het formatteren van getallen
  const formatNumber = (value: number | undefined, prefix: string = ''): string => {
    if (value === undefined) return '-';
    
    return viewMode === 'hours' 
      ? `${prefix}${value.toFixed(1)}` 
      : `${prefix}${new Intl.NumberFormat('nl-NL', { 
          style: 'currency', 
          currency: 'EUR', 
          minimumFractionDigits: 0, 
          maximumFractionDigits: 0 
        }).format(value)}`;
  };

  // Helper voor het formatteren van verschillen (kan negatief zijn)
  const formatDiff = (value: number | undefined): string => {
    if (value === undefined) return '-';
    
    const prefix = value > 0 ? '+' : '';
    return formatNumber(value, prefix);
  };

  // Handler voor kolom sortering
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Wissel richting als dezelfde kolom
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Nieuwe kolom, reset naar asc
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Handler voor het starten van bewerken van KPI waarden
  const handleEditKpi = (month: string, field: 'targetRevenue' | 'finalRevenue') => {
    if (kpiData) {
      const monthData = kpiData.months.find(m => m.month === month);
      const currentValue = monthData ? monthData[field] : 0;
      setEditValue(currentValue?.toString() || '0');
      setEditingKpi({ month, field });
    }
  };

  // Handler voor het opslaan van gewijzigde KPI waarden
  const handleSaveKpi = async () => {
    if (!editingKpi || !kpiData) return;

    try {
      const value = parseFloat(editValue);
      if (isNaN(value)) {
        throw new Error('Ongeldige numerieke waarde');
      }

      // Update via API 
      await updateKPIValue(
        year,
        editingKpi.month, 
        editingKpi.field,
        value
      );
      
      // Update local state (immediately for responsiveness)
      const updatedMonths = kpiData.months.map(month => {
        if (month.month === editingKpi.month) {
          const updatedMonth = { ...month, [editingKpi.field]: value };
          if (editingKpi.field === 'finalRevenue') {
            updatedMonth.targetFinalDiff = value - month.targetRevenue;
          }
          if (editingKpi.field === 'targetRevenue') {
            updatedMonth.targetFinalDiff = (month.finalRevenue || 0) - value;
            updatedMonth.targetTotalDiff = month.totalRevenue - value;
          }
          return updatedMonth;
        }
        return month;
      });
      
      const updatedKpiData = { ...kpiData, months: updatedMonths };
      // Call the handler passed from RevenuePage (which now also refreshes)
      await onKpiUpdate(updatedKpiData); 
      
      // Reset editing state
      setEditingKpi(null);
    } catch (err) {
      console.error('Error saving KPI value:', err);
      alert('Er is een fout opgetreden bij het opslaan van de KPI waarde.');
    }
  };

  // Annuleer bewerken
  const handleCancelEdit = () => {
    setEditingKpi(null);
  };

  // --- NEW: Handlers for Previous Year Consumption Editing ---
  const handleEditConsumption = (entity: RevenueEntity) => {
    // Ensure viewMode is explicitly passed or handled
    const currentValue = entity.previousYearBudgetUsed !== undefined 
        ? (viewMode === 'hours' ? entity.previousYearBudgetUsed.toFixed(1) : entity.previousYearBudgetUsed.toString()) 
        : '0';
    setConsumptionEditValue(currentValue);
    setEditingConsumption({ projectId: entity.id, targetYear: year });
  };

  const handleSaveConsumption = async () => {
    if (!editingConsumption) return;

    try {
      const amountToSave = consumptionEditValue.trim(); 
      const parsedValue = parseFloat(amountToSave);
      if (isNaN(parsedValue)) {
        throw new Error('Ongeldige numerieke waarde');
      }

      console.log(`Saving consumption: Project ID: ${editingConsumption.projectId}, Target Year: ${editingConsumption.targetYear}, Amount: ${amountToSave}, ViewMode: ${viewMode}`);
      const response = await updatePreviousYearConsumption(
        editingConsumption.projectId,
        editingConsumption.targetYear,
        amountToSave, 
        viewMode 
      );

      if (response.success === false) { 
          console.error("Failed to update consumption:", response.message);
          alert(`Fout bij opslaan: ${response.message}`); 
      } else {
          console.log("Consumption update API call successful (message from backend: " + response.message + ")");
          // Trigger data refresh by calling the new prop
          console.log("Triggering data refresh via onRefreshNeeded...");
          await onRefreshNeeded(); 
      }

    } catch (err: unknown) {
      console.error('Error saving consumption value:', err);
      const errorMessage = err instanceof Error ? err.message : 'Onbekende fout';
      alert(`Er is een fout opgetreden bij het opslaan: ${errorMessage}`);
    } finally {
      setEditingConsumption(null); 
    }
  };

  const handleCancelConsumptionEdit = () => {
    setEditingConsumption(null);
  };
  // --- END NEW Handlers ---

  return (
    <div style={{
      maxWidth: "100%", 
      width: "100%",
      margin: "0 auto !important",
      padding: "0",
      display: "flex !important", 
      flexDirection: "column",
      alignItems: "center !important",
      boxSizing: "border-box"
    }}>
      {/* Toggle en Filter Controls */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
        marginBottom: "16px"
      }}>
        {/* Weergave toggle */}
        <div className="flex gap-2">
          <Button
            type="button"
            id="omzet-toggle"
            onClick={() => setViewMode('revenue')}
            className={`px-5 py-2 text-sm font-medium rounded ${viewMode === 'revenue' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-800'}`}
          >
            Omzet (€)
          </Button>
          <Button 
            type="button"
            id="hours-toggle"
            onClick={() => setViewMode('hours')}
            className={`px-5 py-2 text-sm font-medium rounded ${viewMode === 'hours' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-800'}`}
          >
            Uren
          </Button>
        </div>

        {/* Sync Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700">Filter:</span>
          <select 
            value={syncFilter}
            onChange={(e) => setSyncFilter(e.target.value as 'all' | 'synced' | 'unsynced' | 'pending')}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
          >
            <option value="all">Alle statussen</option>
            <option value="synced">Gesynchroniseerd</option>
            <option value="unsynced">Niet gesynchroniseerd</option>
            <option value="pending">In afwachting</option>
          </select>
        </div>
      </div>

      {/* Tabel Container */}
      <div style={{
        boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)",
        borderRadius: "8px",
        overflow: "auto",
        backgroundColor: "white",
        width: "100%",
        maxWidth: "100%",
        minWidth: "1400px"
      }}>
        <table style={{width: "100%", minWidth: "1400px"}} className="border-collapse">
          <thead>
            {/* KPI Rijen - Altijd tonen maar minder opvallend als in hours mode */}
            {kpiData && (
              <>
                {/* Target vs Final Diff Row */}
                <tr style={{ backgroundColor: viewMode === 'revenue' ? "#f0f9ff" : "#f9fafb" }}>
                  <th colSpan={5} style={{
                    padding: "10px",
                    textAlign: "left",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    Verschil target/definitief
                  </th>
                  {months.map(month => {
                    const kpi = kpiData.months.find(k => k.month === month);
                    const diff = kpi?.targetFinalDiff;
                    
                    return (
                      <th key={`diff-final-${month}`} style={{
                        padding: "10px 4px",
                        textAlign: "center",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: diff === undefined ? "#9ca3af" : 
                               viewMode === 'hours' ? "#6b7280" :
                               diff >= 0 ? "#059669" : "#dc2626"
                      }}>
                        {viewMode === 'revenue' ? formatDiff(diff) : "-"}
                      </th>
                    );
                  })}
                  <th colSpan={2} style={{
                    padding: "10px",
                    textAlign: "right",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    -
                  </th>
                </tr>

                {/* Final Revenue Row */}
                <tr style={{ backgroundColor: viewMode === 'revenue' ? "#f0f9ff" : "#f9fafb" }}>
                  <th colSpan={5} style={{
                    padding: "10px",
                    textAlign: "left",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    Definitieve omzet
                  </th>
                  {months.map(month => {
                    const kpi = kpiData.months.find(k => k.month === month);
                    const isEditing = editingKpi?.month === month && editingKpi?.field === 'finalRevenue';
                    
                    return (
                      <th 
                        key={`final-${month}`} 
                        onClick={() => viewMode === 'revenue' && handleEditKpi(month, 'finalRevenue')}
                        style={{
                          padding: "10px 4px",
                          textAlign: "center",
                          fontSize: "13px",
                          fontWeight: 500,
                          color: viewMode === 'revenue' ? "#0369a1" : "#6b7280",
                          borderBottom: "1px dashed #cbd5e1",
                          cursor: viewMode === 'revenue' ? "pointer" : "default"
                        }}
                        title={viewMode === 'revenue' ? "Klik om te bewerken" : ""}
                      >
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="text"
                              className="w-20 px-1 py-0.5 text-center border border-blue-300 rounded"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveKpi()}
                              autoFocus
                            />
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleSaveKpi(); }}
                              className="text-green-600 hover:text-green-800 px-1"
                            >
                              ✓
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                              className="text-red-600 hover:text-red-800 px-1"
                            >
                              ✗
                            </button>
                          </div>
                        ) : (
                          viewMode === 'revenue' && kpi?.finalRevenue !== undefined ? formatNumber(kpi.finalRevenue) : "-"
                        )}
                      </th>
                    );
                  })}
                  <th colSpan={2} style={{
                    padding: "10px",
                    textAlign: "right",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    -
                  </th>
                </tr>

                {/* Target vs Total Diff Row */}
                <tr style={{ backgroundColor: viewMode === 'revenue' ? "#f0f9ff" : "#f9fafb" }}>
                  <th colSpan={5} style={{
                    padding: "10px",
                    textAlign: "left",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    Verschil target/totaal
                  </th>
                  {months.map(month => {
                    const kpi = kpiData.months.find(k => k.month === month);
                    const target = kpi?.targetRevenue || 0;
                    const total = monthlyTotals[month] || 0;
                    const diff = total - target;
                    
                    return (
                      <th key={`diff-total-${month}`} style={{
                        padding: "10px 4px",
                        textAlign: "center",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: diff === 0 ? "#9ca3af" : 
                               viewMode === 'hours' ? "#6b7280" :
                               diff >= 0 ? "#059669" : "#dc2626"
                      }}>
                        {viewMode === 'revenue' ? formatDiff(diff) : "-"}
                      </th>
                    );
                  })}
                  <th colSpan={2} style={{
                    padding: "10px",
                    textAlign: "right",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    -
                  </th>
                </tr>

                {/* Total Revenue Row */}
                <tr style={{ backgroundColor: viewMode === 'revenue' ? "#f0f9ff" : "#f9fafb" }}>
                  <th colSpan={5} style={{
                    padding: "10px",
                    textAlign: "left",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    Totale omzet
                  </th>
                  {months.map(month => (
                    <th key={`total-${month}`} style={{
                      padding: "10px 4px",
                      textAlign: "center",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: viewMode === 'revenue' ? "#0369a1" : "#6b7280",
                      borderBottom: "1px dashed #cbd5e1"
                    }}>
                      {viewMode === 'revenue' ? formatNumber(monthlyTotals[month] || 0) : "-"}
                    </th>
                  ))}
                  <th colSpan={2} style={{
                    padding: "10px",
                    textAlign: "right",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    {viewMode === 'revenue' ? formatNumber(grandTotal) : "-"}
                  </th>
                </tr>

                {/* Target Row */}
                <tr style={{ backgroundColor: viewMode === 'revenue' ? "#f0f9ff" : "#f9fafb" }}>
                  <th colSpan={5} style={{
                    padding: "10px",
                    textAlign: "left",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280"
                  }}>
                    Target
                  </th>
                  {months.map(month => {
                    const kpi = kpiData.months.find(k => k.month === month);
                    const isEditing = editingKpi?.month === month && editingKpi?.field === 'targetRevenue';
                    
                    return (
                      <th 
                        key={`target-${month}`} 
                        onClick={() => viewMode === 'revenue' && handleEditKpi(month, 'targetRevenue')}
                        style={{
                          padding: "10px 4px",
                          textAlign: "center",
                          fontSize: "13px",
                          fontWeight: 600,
                          color: viewMode === 'revenue' ? "#0369a1" : "#6b7280",
                          borderBottom: "2px solid #cbd5e1",
                          cursor: viewMode === 'revenue' ? "pointer" : "default"
                        }}
                        title={viewMode === 'revenue' ? "Klik om te bewerken" : ""}
                      >
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="text"
                              className="w-20 px-1 py-0.5 text-center border border-blue-300 rounded"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveKpi()}
                              autoFocus
                            />
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleSaveKpi(); }}
                              className="text-green-600 hover:text-green-800 px-1"
                            >
                              ✓
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                              className="text-red-600 hover:text-red-800 px-1"
                            >
                              ✗
                            </button>
                          </div>
                        ) : (
                          viewMode === 'revenue' ? formatNumber(kpi?.targetRevenue) : "-"
                        )}
                      </th>
                    );
                  })}
                  <th colSpan={2} style={{
                    padding: "10px",
                    textAlign: "right",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: viewMode === 'revenue' ? "#0369a1" : "#6b7280",
                    borderBottom: "2px solid #cbd5e1"
                  }}>
                    -
                  </th>
                </tr>
              </>
            )}

            {/* Table Headers */}
            <tr style={{
              backgroundColor: "#f3f4f6",
              borderBottom: "1px solid #e5e7eb"
            }}>
              {/* Sorteerbare kolommen */}
              <th 
                onClick={() => handleSort('company')}
                style={{
                  padding: "12px 10px",
                  textAlign: "left",
                  fontSize: "12px", 
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "#6b7280",
                  letterSpacing: "0.05em",
                  width: "15%",
                  cursor: "pointer"
                }}
                title="Klik om te sorteren"
              >
                KLANT {sortColumn === 'company' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th 
                onClick={() => handleSort('name')}
                style={{
                  padding: "12px 10px",
                  textAlign: "left",
                  fontSize: "12px", 
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "#6b7280",
                  letterSpacing: "0.05em",
                  width: "15%",
                  cursor: "pointer"
                }}
                title="Klik om te sorteren"
              >
                PROJECT {sortColumn === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th 
                onClick={() => handleSort('type')}
                style={{
                  padding: "12px 8px",
                  textAlign: "left",
                  fontSize: "12px", 
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "#6b7280",
                  letterSpacing: "0.05em",
                  width: "10%",
                  cursor: "pointer"
                }}
                title="Klik om te sorteren"
              >
                TYPE {sortColumn === 'type' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th 
                onClick={() => handleSort('budget')}
                style={{
                  padding: "12px 8px",
                  textAlign: "right",
                  fontSize: "12px", 
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "#6b7280",
                  letterSpacing: "0.05em",
                  width: "7%",
                  cursor: "pointer"
                }}
                title="Klik om te sorteren"
              >
                BUDGET {sortColumn === 'budget' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th 
                onClick={() => handleSort('previousYearBudget')}
                style={{
                  padding: "12px 8px",
                  textAlign: "right",
                  fontSize: "12px", 
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "#6b7280",
                  letterSpacing: "0.05em",
                  width: "8%",
                  cursor: "pointer"
                }}
                title="Klik om te sorteren"
              >
                VERBRUIKT VORIG JAAR {sortColumn === 'previousYearBudget' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              {/* Maanden */}
              {months.map((month, index) => (
                <th 
                  onClick={() => handleSort(month)}
                  key={month} 
                  style={{
                    padding: "12px 4px",
                    textAlign: "center",
                    fontSize: "12px", 
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: "#6b7280",
                    letterSpacing: "0.05em",
                    width: "4%",
                    minWidth: "60px",
                    cursor: "pointer"
                  }}
                  title="Klik om te sorteren"
                >
                  {monthNames[index]} {sortColumn === month && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
              ))}
              <th 
                onClick={() => handleSort('total')}
                style={{
                  padding: "12px 8px",
                  textAlign: "right",
                  fontSize: "12px", 
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "#6b7280",
                  letterSpacing: "0.05em",
                  backgroundColor: "#f9fafb",
                  width: "7%",
                  cursor: "pointer"
                }}
                title="Klik om te sorteren"
              >
                TOTAAL {sortColumn === 'total' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th 
                onClick={() => handleSort('remaining')}
                style={{
                  padding: "12px 8px",
                  textAlign: "right",
                  fontSize: "12px", 
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "#6b7280",
                  letterSpacing: "0.05em",
                  backgroundColor: "#f3f4f6",
                  width: "7%",
                  cursor: "pointer"
                }}
                title="Klik om te sorteren"
              >
                RESTANT {sortColumn === 'remaining' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map((entity, idx) => {
              // Bereken totaal voor deze rij
              const rowTotal = months.reduce(
                (sum, month) => sum + (viewMode === 'hours' 
                  ? (entity.monthlyHours?.[month] || 0) 
                  : (entity.monthlyRevenue?.[month] || 0)), 
              0);
              
              const isEditingConsumption = editingConsumption?.projectId === entity.id && editingConsumption?.targetYear === year;
              
              return (
                <tr key={entity.id} style={{
                  backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f9fafb",
                  borderBottom: "1px solid #e5e7eb"
                }}>
                  {/* Klant kolom */}
                  <td style={{
                    padding: "12px 10px",
                    fontSize: "14px",
                    color: "#3b82f6",
                    fontWeight: 500
                  }}>
                    {entity.companyName || "-"}
                    {entity.syncStatus && (
                      <span style={{
                        display: "inline-block",
                        marginLeft: "8px",
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: entity.syncStatus === 'synced' ? "#10b981" : 
                                          entity.syncStatus === 'pending' ? "#f59e0b" : "#ef4444"
                      }} title={`Status: ${entity.syncStatus}`}></span>
                    )}
                  </td>
                  
                  {/* Project naam */}
                  <td style={{
                    padding: "12px 10px",
                    fontSize: "14px"
                  }}>
                    <div style={{ fontWeight: 500, color: "#111827" }}>{entity.name}</div>
                  </td>
                  
                  {/* Type */}
                  <td style={{
                    padding: "12px 8px",
                    fontSize: "14px",
                    color: "#4b5563"
                  }}>{entity.type || "-"}</td>
                  
                  {/* Budget */}
                  <td 
                    className="sticky left-[350px] bg-white px-2 py-2 border-b border-r text-xs text-gray-700 whitespace-nowrap z-10 shadow-md"
                    title={entity.totalexclvat ? `Budget (Excl. VAT): ${formatNumber(entity.totalexclvat)}` : 'Geen budget ingesteld'}
                  >
                    {entity.type === 'Vaste prijs' 
                      ? formatNumber(entity.totalexclvat)
                      : '-'}
                  </td>
                  
                  {/* Verbruikt budget vorig jaar - Make editable */}
                  <td 
                    style={{ 
                      padding: "12px 8px", 
                      fontSize: "14px", 
                      fontWeight: 500, 
                      textAlign: "right", 
                      color: "#374151",
                      cursor: "pointer" // Add cursor pointer
                    }}
                    onClick={() => !isEditingConsumption && handleEditConsumption(entity)} // Enable editing on click
                    title="Klik om te bewerken"
                  >
                    {isEditingConsumption ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="text"
                          className="w-20 px-1 py-0.5 text-right border border-blue-300 rounded" // Align text right
                          value={consumptionEditValue}
                          onChange={(e) => setConsumptionEditValue(e.target.value)}
                          onBlur={handleSaveConsumption} // Save on blur
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveConsumption();
                            if (e.key === 'Escape') handleCancelConsumptionEdit();
                          }}
                          autoFocus
                        />
                        {/* Optional: Add save/cancel buttons if needed */}
                        {/* <button onClick={handleSaveConsumption} className="text-green-600">✓</button> */}
                        {/* <button onClick={handleCancelConsumptionEdit} className="text-red-600">✗</button> */} 
                      </div>
                    ) : (
                      formatNumber(entity.previousYearBudgetUsed)
                    )}
                  </td>
                  
                  {/* Maandelijkse waardes */}
                  {months.map(month => {
                    const value = viewMode === 'hours' 
                      ? entity.monthlyHours?.[month] || 0
                      : entity.monthlyRevenue?.[month] || 0;
                    
                    return (
                      <td key={month} style={{
                        padding: "12px 4px",
                        fontSize: "14px",
                        textAlign: "center"
                      }}>
                        {value !== 0 ? (
                          <span style={{ fontWeight: 500, color: "#111827" }}>
                            {formatNumber(value)}
                          </span>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>-</span>
                        )}
                      </td>
                    );
                  })}
                  
                  {/* Totaal voor de rij */}
                  <td style={{
                    padding: "12px 8px",
                    fontSize: "14px",
                    fontWeight: 500,
                    textAlign: "right",
                    color: "#111827",
                    backgroundColor: "#f3f4f6"
                  }}>{formatNumber(rowTotal)}</td>
                  
                  {/* Restant voor de rij */}
                  <td style={{
                    padding: "12px 8px",
                    fontSize: "14px",
                    fontWeight: 500,
                    textAlign: "right",
                    color: "#111827",
                    backgroundColor: entity.remainingBudget && entity.remainingBudget < 0 ? "#fee2e2" : "#f3f4f6"
                  }}>{formatNumber(entity.remainingBudget)}</td>
                </tr>
              );
            })}
            
            {/* Total Row */}
            <tr style={{
              backgroundColor: "#f3f4f6",
              borderTop: "2px solid #e5e7eb"
            }}>
              <td colSpan={5} style={{
                padding: "12px 10px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#4b5563"
              }}>TOTAAL</td>
              {months.map(month => (
                <td key={month} style={{
                  padding: "12px 4px",
                  fontSize: "14px",
                  fontWeight: 600,
                  textAlign: "center",
                  color: "#4b5563"
                }}>
                  {formatNumber(monthlyTotals[month] || 0)}
                </td>
              ))}
              <td style={{
                padding: "12px 8px",
                fontSize: "14px",
                fontWeight: 600,
                textAlign: "right",
                color: "#1f2937",
                backgroundColor: "#e5e7eb"
              }}>{formatNumber(grandTotal)}</td>
              <td style={{
                padding: "12px 8px",
                fontSize: "14px",
                fontWeight: 600,
                textAlign: "right",
                color: "#1f2937",
                backgroundColor: totalRemaining < 0 ? "#fee2e2" : "#e5e7eb"
              }}>{formatNumber(totalRemaining)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RevenueTable; 