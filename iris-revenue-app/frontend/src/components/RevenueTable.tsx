import React, { useState } from 'react';
import {
  RevenueEntity,
  YearlyKPIs,
  updateKPIValue,
  updatePreviousYearConsumption
} from '../services/api';
// Use the alias path if available
import { Button } from '@/components/ui/button';
import useRevenueStore, { CalculationMode } from '../store/revenueStore';

interface RevenueTableProps {
  data: RevenueEntity[];
  year: number;
  kpiData: YearlyKPIs | null;
  onKpiUpdate: (updatedKpiData: YearlyKPIs) => Promise<void>;
  onRefreshNeeded: (forceRefresh?: boolean) => Promise<void>;
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

// Function to determine row styling based on project type
const getRowTypeClass = (entity: RevenueEntity): string => {
  // First check if it's an offer
  if (entity.herkomst === 'Offerte') {
    return 'bg-purple-100';
  }

  // Then check by type
  switch (entity.type) {
    case 'Vaste prijs':
      return 'bg-blue-50';
    case 'Nacalculatie':
      return 'bg-green-50';
    case 'Contract':
      return 'bg-purple-50';
    default:
      return '';
  }
};

const RevenueTable: React.FC<RevenueTableProps> = ({ data, year, kpiData, onKpiUpdate, onRefreshNeeded }) => {
  // State voor weergave mode (uren/euro's) - DEFAULT NAAR OMZET
  const [viewMode, setViewMode] = useState<ViewMode>('revenue');

  // Haal de calculation mode uit de store
  const { calculationMode, setCalculationMode } = useRevenueStore();

  // Log de calculation mode bij elke render
  console.log(`[RevenueTable] Current calculation mode: ${calculationMode}`);

  // State voor sorteren
  const [sortColumn, setSortColumn] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // State voor het bewerken van KPI waarden
  const [editingKpi, setEditingKpi] = useState<{month: string, field: 'targetRevenue' | 'finalRevenue'} | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // State for editing previous year consumption
  const [editingConsumption, setEditingConsumption] = useState<{ projectId: number, targetYear: number } | null>(null);
  const [consumptionEditValue, setConsumptionEditValue] = useState<string>('');

  // State for tracking which rows are included in the totals
  const [includedRows, setIncludedRows] = useState<Record<number, boolean>>({});

  // Format maandnamen voor kolomheaders
  const monthNames = [
    'jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
    'jul', 'aug', 'sep', 'okt', 'nov', 'dec'
  ];

  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
    .map(month => `${year}-${month}`);

  // Initialize all entities as included when data changes
  React.useEffect(() => {
    const initialIncludedRows: Record<number, boolean> = {};
    data.forEach(entity => {
      initialIncludedRows[entity.id] = true;
    });
    setIncludedRows(initialIncludedRows);
  }, [data]);

  // Toggle a row's inclusion in totals
  const toggleRowInclusion = (entityId: number) => {
    setIncludedRows(prev => ({
      ...prev,
      [entityId]: !prev[entityId]
    }));
  };

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
    const filtered = data.filter(entity => entityHasDataForYear(entity, viewMode));

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

  // Bereken totalen per maand voor projecten - enkel voor geïncludeerde rijen
  const monthlyTotals = months.reduce((acc, month) => {
    acc[month] = filteredData.reduce((sum, entity) =>
      sum + (includedRows[entity.id] ?
        (viewMode === 'hours'
          ? (entity.monthlyHours?.[month] || 0)
          : (entity.monthlyRevenue?.[month] || 0))
        : 0),
    0);
    return acc;
  }, {} as {[month: string]: number});

  // Bereken totaal voor alle projecten en maanden - enkel voor geïncludeerde rijen
  const monthlyGrandTotal = Object.values(monthlyTotals).reduce((sum, value) => sum + value, 0);

  // Include previous year consumption in grand total only in revenue view - enkel voor geïncludeerde rijen
  const totalPreviousYearConsumption = viewMode === 'revenue'
    ? filteredData.reduce((sum, entity) =>
        sum + (includedRows[entity.id] ? (entity.previousYearBudgetUsed || 0) : 0), 0)
    : 0;
  const grandTotal = monthlyGrandTotal;

  // Bereken restant totaal (sum of all entity remaining values) - enkel voor geïncludeerde rijen
  const totalBudget = filteredData.reduce((sum, entity) => {
    if ((entity.type === 'Vaste prijs' || entity.herkomst === 'Offerte') && includedRows[entity.id]) {
      return sum + (entity.totalexclvat || 0);
    }
    return sum;
  }, 0);

  const totalRemaining = totalBudget - grandTotal;

  // Bereken totalen voor KPI rijen
  // Totaal voor target
  const totalTarget = kpiData ? kpiData.months.reduce((sum, month) => sum + (month.targetRevenue || 0), 0) : 0;

  // Totaal voor definitieve omzet
  const totalFinalRevenue = kpiData ? kpiData.months.reduce((sum, month) => sum + (month.finalRevenue || 0), 0) : 0;

  // Totaal voor verschil target/definitief
  const totalTargetFinalDiff = totalFinalRevenue - totalTarget;

  // Totaal voor verschil target/totaal
  const totalTargetTotalDiff = monthlyGrandTotal - totalTarget;

  // Helper voor het formatteren van getallen
  const formatNumber = (value: number | undefined, prefix: string = ''): string => {
    if (value === undefined) return '-';

    return viewMode === 'hours'
      ? `${prefix}${value.toFixed(1)}`
      : `${prefix}${new Intl.NumberFormat('nl-NL', {
          style: 'currency',
          currency: 'EUR',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
          // Gebruik een vaste breedte voor de getallen
          useGrouping: true
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
      // Verbeterde validatie met betere foutmelding
      const trimmedValue = editValue.trim();

      // Controleer of de waarde niet leeg is
      // Lege waarde of '0' is toegestaan (wordt behandeld als 0)
      if (trimmedValue === '') {
        // Als de waarde leeg is, behandel het als 0
        setEditValue('0');
      }

      // Controleer of het een geldig getal is
      const value = parseFloat(trimmedValue);
      if (isNaN(value)) {
        alert('Voer een geldig getal in. Gebruik een punt (.) als decimaalteken.');
        return; // Niet doorgaan met opslaan
      }

      // Toon een indicator dat we aan het opslaan zijn
      console.log(`Saving KPI: ${editingKpi.month}, ${editingKpi.field} = ${value}`);

      // Eerst de API-aanroep doen
      try {
        const response = await updateKPIValue(
          year,
          editingKpi.month,
          editingKpi.field,
          value
        );

        console.log("API response:", response);

        if (response.success) {
          // Als de API-aanroep succesvol is, update de lokale data
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
          console.log("KPI update complete, data refreshed");
        } else {
          // Als de API-aanroep mislukt, toon een foutmelding
          alert(`Fout bij opslaan: ${response.message}`);
        }
      } catch (apiError) {
        console.error('API Error saving KPI value:', apiError);
        alert(`API fout bij opslaan: ${apiError instanceof Error ? apiError.message : 'Onbekende fout'}`);
        return;
      }
    } catch (err) {
      console.error('Error in handleSaveKpi:', err);
      alert(`Er is een fout opgetreden: ${err instanceof Error ? err.message : 'Onbekende fout'}`);
    } finally {
      // Reset editing state
      setEditingKpi(null);
    }
  };

  // Annuleer bewerken en zet waarde op 0
  const handleCancelEdit = async () => {
    if (!editingKpi || !kpiData) {
      setEditingKpi(null);
      return;
    }

    try {
      // Expliciet de waarde op 0 zetten via API
      console.log(`Setting KPI value to 0: ${editingKpi.month}, ${editingKpi.field}`);

      const response = await updateKPIValue(
        year,
        editingKpi.month,
        editingKpi.field,
        0 // Expliciet 0 als waarde
      );

      if (response.success) {
        // Als de API-aanroep succesvol is, update de lokale data
        const updatedMonths = kpiData.months.map(month => {
          if (month.month === editingKpi.month) {
            const updatedMonth = { ...month, [editingKpi.field]: 0 };
            if (editingKpi.field === 'finalRevenue') {
              updatedMonth.targetFinalDiff = 0 - month.targetRevenue;
            }
            if (editingKpi.field === 'targetRevenue') {
              updatedMonth.targetFinalDiff = (month.finalRevenue || 0) - 0;
              updatedMonth.targetTotalDiff = month.totalRevenue - 0;
            }
            return updatedMonth;
          }
          return month;
        });

        const updatedKpiData = { ...kpiData, months: updatedMonths };

        // Call the handler passed from RevenuePage (which now also refreshes)
        await onKpiUpdate(updatedKpiData);
        console.log("KPI update complete, data refreshed");
      } else {
        console.error("Failed to set KPI value to 0:", response.message);
      }
    } catch (err) {
      console.error('Error in handleCancelEdit:', err);
    } finally {
      // Reset editing state
      setEditingKpi(null);
    }
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
      // Verbeterde validatie met betere foutmelding
      const amountToSave = consumptionEditValue.trim();

      // Controleer of de waarde niet leeg is
      // Lege waarde of '0' is toegestaan (wordt behandeld als 0)
      if (amountToSave === '') {
        // Als de waarde leeg is, behandel het als 0
        setConsumptionEditValue('0');
      }

      // Controleer of het een geldig getal is
      const parsedValue = parseFloat(amountToSave);
      if (isNaN(parsedValue)) {
        alert('Voer een geldig getal in. Gebruik een punt (.) als decimaalteken.');
        return; // Niet doorgaan met opslaan
      }

      // Toon een indicator dat we aan het opslaan zijn
      console.log(`Saving consumption: Project ID: ${editingConsumption.projectId}, Target Year: ${editingConsumption.targetYear}, Amount: ${amountToSave}, ViewMode: ${viewMode}`);

      // Eerst de API-aanroep doen
      try {
        const response = await updatePreviousYearConsumption(
          editingConsumption.projectId,
          editingConsumption.targetYear,
          amountToSave,
          viewMode
        );

        console.log("API response:", response);

        if (response.success) {
          // Als de API-aanroep succesvol is, update de lokale data
          const entityToUpdate = data.find(entity => entity.id === editingConsumption.projectId);
          if (entityToUpdate) {
            entityToUpdate.previousYearBudgetUsed = parsedValue;
          }

          // Trigger data refresh by calling the new prop
          console.log("Triggering data refresh via onRefreshNeeded...");
          await onRefreshNeeded(true); // Force refresh om zeker te zijn dat de data up-to-date is

          // Toon een bevestiging dat het opslaan is gelukt
          console.log("Data refresh complete");
        } else {
          // Als de API-aanroep mislukt, toon een foutmelding
          alert(`Fout bij opslaan: ${response.message}`);
        }
      } catch (apiError) {
        console.error('API Error saving consumption value:', apiError);
        alert(`API fout bij opslaan: ${apiError instanceof Error ? apiError.message : 'Onbekende fout'}`);
        return;
      }
    } catch (err: unknown) {
      console.error('Error in handleSaveConsumption:', err);
      const errorMessage = err instanceof Error ? err.message : 'Onbekende fout';
      alert(`Er is een fout opgetreden bij het opslaan: ${errorMessage}`);
    } finally {
      // Sluit de bewerkingsmodus
      setEditingConsumption(null);
    }
  };

  const handleCancelConsumptionEdit = () => {
    // Alleen de bewerkingsmodus sluiten zonder wijzigingen op te slaan
    setEditingConsumption(null);
    console.log('Bewerking geannuleerd, geen wijzigingen opgeslagen');
  };
  // --- END NEW Handlers ---

  return (
    <div className="revenue-table-container" style={{ padding: '30px' }}>
      {/* Compacte, elegante header met weergave en berekeningsmethode controls */}
      {/* Header met consistente knoppen en 5px spacing */}
      <div className="w-full mb-3 flex flex-wrap items-center p-2">
        {/* Weergave toggle - consistente knoppen */}
        <div className="flex mr-[5px]">
          <button
            type="button"
            id="omzet-toggle"
            onClick={() => setViewMode('revenue')}
            className={`px-3 py-1 text-xs font-medium rounded-l-md h-7 flex items-center justify-center ${
              viewMode === 'revenue'
                ? 'bg-black text-white border border-black'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 border border-gray-300'
            }`}
            style={{ minWidth: '60px' }}
          >
            <span className="flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              €
            </span>
          </button>
          <button
            type="button"
            id="hours-toggle"
            onClick={() => setViewMode('hours')}
            className={`px-3 py-1 text-xs font-medium rounded-r-md h-7 flex items-center justify-center ${
              viewMode === 'hours'
                ? 'bg-black text-white border border-black'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 border border-gray-300'
            }`}
            style={{ minWidth: '60px' }}
          >
            <span className="flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Uren
            </span>
          </button>
        </div>

        {/* Berekeningsmethode toggle knoppen - consistente knoppen */}
        {viewMode === 'revenue' && (
          <div className="flex">
            <button
              type="button"
              id="project-max-toggle"
              onClick={() => setCalculationMode('projectMax')}
              className={`px-3 py-1 text-xs font-medium rounded-l-md h-7 flex items-center justify-center ${
                calculationMode === 'projectMax'
                  ? 'bg-black text-white border border-black'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300 border border-gray-300'
              }`}
              style={{ minWidth: '70px' }}
            >
              <span className="flex items-center justify-center whitespace-nowrap">
                {calculationMode === 'projectMax' && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                Project
              </span>
            </button>
            <button
              type="button"
              id="line-max-toggle"
              onClick={() => setCalculationMode('lineMax')}
              className={`px-3 py-1 text-xs font-medium rounded-r-md h-7 flex items-center justify-center ${
                calculationMode === 'lineMax'
                  ? 'bg-black text-white border border-black'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300 border border-gray-300'
              }`}
              style={{ minWidth: '70px' }}
            >
              <span className="flex items-center justify-center whitespace-nowrap">
                {calculationMode === 'lineMax' && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                Projectregel
              </span>
            </button>
          </div>
        )}

        {/* Uitleg - alleen tonen als nodig */}
        {viewMode === 'revenue' && (
          <div className="text-xs text-gray-600 ml-auto">
            <span className="font-medium">
              {calculationMode === 'projectMax'
                ? 'Uitleg: Alle uren worden vermenigvuldigd met het uurtarief, ongeacht of de projectregel over budget is.'
                : 'Uitleg: Uren worden berekend tot de max van elke projectregel. Overspend uren binnen een regel leveren €0 op.'}
            </span>
          </div>
        )}
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
                  {/* Lege cel voor verbruikt vorig jaar in KPI rijen - niet tonen */}
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
                               diff >= 0 ? "#059669" : "#dc2626",
                        width: "80px",
                        minWidth: "80px",
                        maxWidth: "80px"
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
                    color: totalTargetFinalDiff === undefined ? "#9ca3af" :
                           viewMode === 'hours' ? "#6b7280" :
                           totalTargetFinalDiff >= 0 ? "#059669" : "#dc2626"
                  }}>
                    {viewMode === 'revenue' ? formatDiff(totalTargetFinalDiff) : "-"}
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
                  {/* Geen lege cel voor verbruikt vorig jaar in deze rij */}
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
                          cursor: viewMode === 'revenue' ? "pointer" : "default",
                          width: "80px",
                          minWidth: "80px",
                          maxWidth: "80px"
                        }}
                        title={viewMode === 'revenue' ? "Klik om te bewerken" : ""}
                      >
                        {isEditing ? (
                          <div className="flex flex-col items-center gap-1" style={{ position: "fixed", zIndex: 999999, top: "50%", left: "50%", transform: "translate(-50%, -50%)", backgroundColor: "#000", padding: "8px", borderRadius: "8px", boxShadow: "0 0 10px rgba(0,0,0,0.5)" }}>
                            <input
                              type="text"
                              className="w-20 px-1 py-0.5 text-center border border-blue-300 rounded bg-white"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveKpi();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              autoFocus
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSaveKpi(); }}
                              className="text-white hover:text-white px-2 py-1 bg-green-600 hover:bg-green-700 border border-green-700 rounded shadow-md"
                              title="Opslaan"
                            >
                              ✓
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                              className="text-white hover:text-white px-2 py-1 bg-red-600 hover:bg-red-700 border border-red-700 rounded shadow-md"
                              title="Annuleren"
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
                    {viewMode === 'revenue' ? formatNumber(totalFinalRevenue) : "-"}
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
                  {/* Lege cel voor verbruikt vorig jaar in KPI rijen - niet tonen */}
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
                               diff >= 0 ? "#059669" : "#dc2626",
                        width: "80px",
                        minWidth: "80px",
                        maxWidth: "80px"
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
                    color: totalTargetTotalDiff === 0 ? "#9ca3af" :
                           viewMode === 'hours' ? "#6b7280" :
                           totalTargetTotalDiff >= 0 ? "#059669" : "#dc2626"
                  }}>
                    {viewMode === 'revenue' ? formatDiff(totalTargetTotalDiff) : "-"}
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
                  {/* Geen lege cel voor verbruikt vorig jaar in deze rij */}
                  {months.map(month => (
                    <th key={`total-${month}`} style={{
                      padding: "10px 4px",
                      textAlign: "center",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: viewMode === 'revenue' ? "#0369a1" : "#6b7280",
                      borderBottom: "1px dashed #cbd5e1",
                      width: "80px",
                      minWidth: "80px",
                      maxWidth: "80px"
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
                    {viewMode === 'revenue' ? formatNumber(monthlyGrandTotal) : "-"}
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
                  {/* Lege cel voor verbruikt vorig jaar in KPI rijen - niet tonen */}
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
                          cursor: viewMode === 'revenue' ? "pointer" : "default",
                          width: "80px",
                          minWidth: "80px",
                          maxWidth: "80px",
                          whiteSpace: "normal"
                        }}
                        title={viewMode === 'revenue' ? "Klik om te bewerken" : ""}
                      >
                        {isEditing ? (
                          <div className="flex flex-col items-center gap-1" style={{ position: "fixed", zIndex: 999999, top: "50%", left: "50%", transform: "translate(-50%, -50%)", backgroundColor: "#000", padding: "8px", borderRadius: "8px", boxShadow: "0 0 10px rgba(0,0,0,0.5)" }}>
                            <input
                              type="text"
                              className="w-20 px-1 py-0.5 text-center border border-blue-300 rounded bg-white"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveKpi();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              autoFocus
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSaveKpi(); }}
                              className="text-white hover:text-white px-2 py-1 bg-green-600 hover:bg-green-700 border border-green-700 rounded shadow-md"
                              title="Opslaan"
                            >
                              ✓
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                              className="text-white hover:text-white px-2 py-1 bg-red-600 hover:bg-red-700 border border-red-700 rounded shadow-md"
                              title="Annuleren"
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
                    {viewMode === 'revenue' ? formatNumber(totalTarget) : "-"}
                  </th>
                </tr>
              </>
            )}

            {/* Table Headers */}
            <tr style={{
              backgroundColor: "#f3f4f6",
              borderBottom: "1px solid #e5e7eb"
            }}>
              {/* Inclusie kolom */}
              <th style={{
                padding: "12px 10px",
                textAlign: "center",
                fontSize: "12px",
                fontWeight: 600,
                textTransform: "uppercase",
                color: "#6b7280",
                letterSpacing: "0.05em",
                width: "50px"
              }}>
                INCL.
              </th>

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
              {/* Verbruikt vorig jaar kolom - verplaatst naar na de maanden */}
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
                    width: "80px",
                    minWidth: "80px",
                    maxWidth: "80px",
                    cursor: "pointer"
                  }}
                  title="Klik om te sorteren"
                >
                  {monthNames[index]} {sortColumn === month && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
              ))}
              {/* Verbruikt vorig jaar kolom - na de maanden */}
              {viewMode === 'revenue' && (
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
                    width: "80px",
                    minWidth: "80px",
                    maxWidth: "80px",
                    whiteSpace: "normal",
                    cursor: "pointer"
                  }}
                  title="Klik om te sorteren"
                >
                  VORIG JAAR {sortColumn === 'previousYearBudget' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
              )}
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
              // Bereken totaal voor deze rij (inclusief toekomstige maanden, maar markeer ze)
              const monthlySum = months.reduce(
                (sum, month) => {
                  // Haal de waarde op en controleer of het een geldige numerieke waarde is
                  const value = viewMode === 'hours'
                    ? (entity.monthlyHours?.[month] || 0)
                    : (entity.monthlyRevenue?.[month] || 0);

                  // Log ongewoon hoge uren, maar pas ze niet aan (Gripp data is leidend)
                  if (viewMode === 'hours' && value > 500) {
                    console.warn(`[RevenueTable] Unusually high hours detected for entity ${entity.id} (${entity.name}) in month ${month}: ${value}`);
                  }



                  return sum + value;
                },
              0);

              // Removed check for unusually high hours for a single project
              const hasUnusuallyHighHours = false;

              // Check if this project has hours in future months
              const hasFutureMonthsWithHours = months.some(month => {
                const [yearStr, monthStr] = month.split('-');
                const monthDate = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
                const currentDate = new Date();
                const isMonthInFuture = monthDate > currentDate;
                const value = viewMode === 'hours' ? (entity.monthlyHours?.[month] || 0) : (entity.monthlyRevenue?.[month] || 0);
                return isMonthInFuture && value > 0;
              });

              // Include previous year consumption in the total only in revenue view
              const rowTotal = monthlySum;

              // Calculate remaining based on total (verbruik vorig jaar is al opgenomen in rowTotal)
              const entityRemaining = entity.type === 'Vaste prijs'
                ? ((entity.totalexclvat || 0) - rowTotal)
                : entity.remainingBudget;

              const isEditingConsumption = editingConsumption?.projectId === entity.id && editingConsumption?.targetYear === year;

              return (
                <tr key={entity.id} style={{
                  backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f9fafb",
                  borderBottom: "1px solid #e5e7eb"
                }}>
                  {/* Include toggle checkbox */}
                  <td style={{
                    padding: "12px 4px",
                    textAlign: "center"
                  }}>
                    <input
                      type="checkbox"
                      checked={includedRows[entity.id] || false}
                      onChange={() => toggleRowInclusion(entity.id)}
                      className="w-4 h-4 cursor-pointer"
                      title="Rij meenemen in totalen"
                    />
                  </td>

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
                    <div key={`entity-${idx}`} className="flex flex-col p-0">
                      <div className={`flex border-b border-gray-200 ${getRowTypeClass(entity)} hover:bg-gray-100 transition-colors duration-150 ease-in-out`}>
                        <div className="w-[350px] min-w-[350px] max-w-[350px] font-medium truncate px-3 py-2 flex">
                          <div className="truncate">
                            <span>{entity.name}</span>
                            {entity.herkomst === 'Offerte' && (
                              <span className="ml-2 text-xs font-semibold bg-purple-200 text-purple-700 px-2 py-0.5 rounded">
                                Offerte
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Type */}
                  <td style={{
                    padding: "12px 8px",
                    fontSize: "14px",
                    color: "#4b5563"
                  }}>
                    {entity.displayType || entity.type || "-"}
                  </td>

                  {/* Budget */}
                  <td
                    className="sticky left-[350px] bg-white px-2 py-2 border-b border-r text-xs text-gray-700 whitespace-nowrap z-10 shadow-md"
                    title={entity.totalexclvat ? `Budget (Excl. VAT): ${formatNumber(entity.totalexclvat)}` : 'Geen budget ingesteld'}
                  >
                    {(entity.type === 'Vaste prijs' || entity.herkomst === 'Offerte')
                      ? formatNumber(entity.totalexclvat)
                      : '-'}
                  </td>

                  {/* Verbruikt budget vorig jaar - verplaatst naar na de maanden */}

                  {/* Maandelijkse waardes */}
                  {months.map(month => {
                    // Check if the month is in the future
                    const isMonthInFuture = () => {
                      const currentDate = new Date();
                      const [yearStr, monthStr] = month.split('-');
                      const monthDate = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
                      return monthDate > currentDate;
                    };

                    // Get the value (don't filter future months, just flag them)
                    const value = viewMode === 'hours'
                      ? entity.monthlyHours?.[month] || 0
                      : entity.monthlyRevenue?.[month] || 0;

                    // Log ongewoon hoge uren, maar pas ze niet aan (Gripp data is leidend)
                    if (viewMode === 'hours' && value > 100) {
                      console.warn(`[RevenueTable] Unusually high hours detected for entity ${entity.id} (${entity.name}) in month ${month}: ${value}`);

                      // Log extra details voor debugging
                      console.log(`[RevenueTable DEBUG] Entity details:`, {
                        id: entity.id,
                        name: entity.name,
                        companyName: entity.companyName,
                        herkomst: entity.herkomst,
                        type: entity.type,
                        displayType: entity.displayType,
                        monthlyHours: entity.monthlyHours?.[month],
                        monthlyRevenue: entity.monthlyRevenue?.[month]
                      });

                      // Controleer of de naam een Gripp ID bevat tussen haakjes
                      const grippIdMatch = entity.name.match(/\((\d+)\)$/);
                      if (grippIdMatch && grippIdMatch[1]) {
                        const grippId = parseInt(grippIdMatch[1]);
                        console.log(`[RevenueTable DEBUG] Entity ${entity.id} has Gripp ID ${grippId} in its name`);
                      }
                    }

                    // Removed check for unusually high hours in a single month
                    const hasUnusuallyHighMonthlyHours = false;

                    // Flag hours in future months
                    const hasFutureHours = isMonthInFuture() && value > 0;

                    // Check if this month has over-budget lines (show in both calculation modes)
                    const hasOverBudgetLine = viewMode === 'revenue' && entity.overBudgetMonths?.[month] === true;

                    // Debug logging to check if overBudgetMonths is being set correctly
                    // Log all entities with overBudgetMonths set to true
                    if (entity.overBudgetMonths?.[month] === true) {
                      console.log(`[OVER BUDGET] Entity ${entity.id} (${entity.name}), Month ${month}, hasOverBudgetLine:`, hasOverBudgetLine);
                    }

                    return (
                      <td key={month} style={{
                        padding: "12px 4px",
                        fontSize: "14px",
                        textAlign: "center",
                        position: "relative", // For positioning the indicator
                        width: "80px",
                        minWidth: "80px",
                        maxWidth: "80px"
                      }}>
                        {value !== 0 ? (
                          <div className="relative inline-block">
                            <span style={{ fontWeight: 500, color: hasUnusuallyHighMonthlyHours ? "#ef4444" : "#111827" }}>
                              {formatNumber(value)}
                            </span>
                            {/* Red dot indicator for over-budget lines */}
                            {hasOverBudgetLine && (
                              <div className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2">
                                <span
                                  className="flex items-center justify-center w-6 h-6 bg-red-600 rounded-full border-2 border-white shadow-lg animate-pulse"
                                  title="Deze maand bevat uren op projectregels die over budget zijn"
                                >
                                  <span className="text-white text-xs font-bold">!</span>
                                </span>
                              </div>
                            )}
                            {/* Warning for unusually high hours - removed */}
                            {/* Warning for hours in future months */}
                            {hasFutureHours && (
                              <div className="text-xs text-orange-600 font-normal absolute -top-4 left-0 right-0 text-center">
                                Toekomstige uren
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>-</span>
                        )}
                      </td>
                    );
                  })}

                  {/* Verbruikt budget vorig jaar - na de maanden */}
                  {viewMode === 'revenue' && (
                    <td
                      style={{
                        padding: "12px 8px",
                        fontSize: "14px",
                        fontWeight: 500,
                        textAlign: "right",
                        color: "#374151",
                        cursor: "pointer", // Add cursor pointer
                        width: "80px",
                        minWidth: "80px",
                        maxWidth: "80px",
                        whiteSpace: "normal",
                        position: "relative" // Add position relative
                      }}
                      onClick={() => !isEditingConsumption && handleEditConsumption(entity)} // Enable editing on click
                      title="Klik om te bewerken"
                    >
                      {isEditingConsumption ? (
                        <div className="flex flex-col items-end gap-1" style={{ position: "fixed", zIndex: 99999, top: "50%", left: "50%", transform: "translate(-50%, -50%)", backgroundColor: "#000", padding: "8px", borderRadius: "8px", boxShadow: "0 0 10px rgba(0,0,0,0.5)" }}>
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="text"
                              className="w-20 px-1 py-0.5 text-right border border-blue-300 rounded bg-white" // Align text right
                              value={consumptionEditValue}
                              onChange={(e) => setConsumptionEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveConsumption();
                                if (e.key === 'Escape') handleCancelConsumptionEdit();
                              }}
                              autoFocus
                            />
                          </div>
                          {/* Add explicit save/cancel buttons in a separate row */}
                          <div className="flex items-center justify-end gap-1 mt-1" style={{ position: "relative", zIndex: 100000 }}>
                            <button
                              onClick={handleSaveConsumption}
                              className="text-white hover:text-white px-2 py-1 bg-green-600 hover:bg-green-700 border border-green-700 rounded shadow-md"
                              title="Opslaan"
                            >
                              ✓
                            </button>
                            <button
                              onClick={handleCancelConsumptionEdit}
                              className="text-white hover:text-white px-2 py-1 bg-red-600 hover:bg-red-700 border border-red-700 rounded shadow-md"
                              title="Annuleren"
                            >
                              ✗
                            </button>
                          </div>
                        </div>
                      ) : (
                        formatNumber(entity.previousYearBudgetUsed)
                      )}
                    </td>
                  )}

                  {/* Totaal voor de rij */}
                  <td style={{
                    padding: "12px 8px",
                    fontSize: "14px",
                    fontWeight: 500,
                    textAlign: "right",
                    color: hasUnusuallyHighHours || hasFutureMonthsWithHours ? "#ef4444" : "#111827",
                    backgroundColor: hasUnusuallyHighHours ? "#fee2e2" : hasFutureMonthsWithHours ? "#fff3e0" : "#f3f4f6"
                  }}>
                    {formatNumber(rowTotal)}
                    {/* Warning for unusually high hours - removed */}
                    {hasFutureMonthsWithHours && (
                      <div className="text-xs text-orange-600 font-normal">
                        Bevat toekomstige uren
                      </div>
                    )}
                  </td>

                  {/* Restant voor de rij */}
                  <td style={{
                    padding: "12px 8px",
                    fontSize: "14px",
                    fontWeight: 500,
                    textAlign: "right",
                    color: "#111827",
                    backgroundColor: entityRemaining !== undefined && entityRemaining < 0 ? "#fee2e2" : "#f3f4f6"
                  }}>{formatNumber(entityRemaining)}</td>
                </tr>
              );
            })}

            {/* Total Row */}
            <tr style={{
              backgroundColor: "#f3f4f6",
              borderTop: "2px solid #e5e7eb"
            }}>
              <td style={{
                padding: "12px 10px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#4b5563",
                textAlign: "center"
              }}>
                -
              </td>
              <td colSpan={4} style={{
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
                  color: "#4b5563",
                  width: "80px",
                  minWidth: "80px",
                  maxWidth: "80px"
                }}>
                  {formatNumber(monthlyTotals[month] || 0)}
                </td>
              ))}
              {/* Previous Year Consumption Total - na de maanden */}
              {viewMode === 'revenue' && (
                <td style={{
                  padding: "12px 8px",
                  fontSize: "14px",
                  fontWeight: 600,
                  textAlign: "right",
                  color: "#4b5563",
                  width: "80px",
                  minWidth: "80px",
                  maxWidth: "80px",
                  whiteSpace: "normal"
                }}>
                  {formatNumber(totalPreviousYearConsumption)}
                </td>
              )}
              <td style={{
                padding: "12px 8px",
                fontSize: "14px",
                fontWeight: 600,
                textAlign: "right",
                color: "#1f2937",
                backgroundColor: "#e5e7eb"
              }}>{formatNumber(monthlyGrandTotal)}</td>
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