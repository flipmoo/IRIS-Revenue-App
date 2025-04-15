import axios from 'axios';

// Define the base URL for the backend API
// Use environment variable or default for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3005/api';

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Interface matching the backend's EnrichedRevenueEntity
// We should ideally share this type between backend and frontend
export interface RevenueEntity {
    id: number;
    name: string;
    companyName?: string;
    type?: string;
    totalBudget?: number;
    totalexclvat?: number;
    monthlyHours?: { [key: string]: number };
    monthlyRevenue?: { [key: string]: number };
    // Velden die overeenkomen met echte database tabellen
    previousYearBudgetUsed?: number; // Uit manual_project_previous_consumption
    remainingBudget?: number;        // Berekend veld (totalBudget - verbruik)
    syncStatus?: 'synced' | 'unsynced' | 'pending'; // Status voor filtering
}

// Nieuw type voor KPI informatie
export interface MonthlyKPI {
    month: string;                // Format: YYYY-MM
    targetRevenue: number;        // Target voor die maand (handmatig)
    finalRevenue?: number;        // Definitieve omzet (handmatig)
    totalRevenue: number;         // Berekend totaal van alle projecten
    targetFinalDiff?: number;     // Verschil tussen target en definitieve omzet
    targetTotalDiff: number;      // Verschil tussen target en totale omzet
}

// Verzameling van KPI's per jaar
export interface YearlyKPIs {
    year: number;
    months: MonthlyKPI[];
}

// Mock data voor de KPI's
export const getMockKPIs = (year: number): YearlyKPIs => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
        .map(month => `${year}-${month}`);
    
    return {
        year,
        months: months.map(month => ({
            month,
            targetRevenue: Math.floor(Math.random() * 100000) + 80000, // Random target tussen 80k-180k
            finalRevenue: month < `${year}-${new Date().getMonth() + 1}` ? Math.floor(Math.random() * 100000) + 80000 : undefined, // Alleen definitief voor voltooide maanden
            totalRevenue: Math.floor(Math.random() * 100000) + 70000, // Random totaal tussen 70k-170k
            get targetFinalDiff() { 
                return this.finalRevenue !== undefined ? this.finalRevenue - this.targetRevenue : undefined;
            },
            get targetTotalDiff() {
                return this.totalRevenue - this.targetRevenue;
            }
        }))
    };
};

// Functie om mock data toe te voegen aan de bestaande RevenueEntity data
export const enhanceRevenueData = (data: RevenueEntity[]): RevenueEntity[] => {
    return data.map(entity => ({
        ...entity,
        previousYearBudgetUsed: Math.floor(Math.random() * 15000), // Random verbruik vorig jaar
        remainingBudget: (entity.totalBudget || 0) - Math.floor(Math.random() * 30000), // Random overgebleven budget
        syncStatus: ['synced', 'unsynced', 'pending'][Math.floor(Math.random() * 3)] as 'synced' | 'unsynced' | 'pending' // Random sync status
    }));
};

/**
 * Fetches the enriched revenue data for a specific year.
 * @param year The year to fetch data for.
 * @returns A promise resolving to an array of RevenueEntity.
 */
export const getRevenueDataByYear = async (year: number): Promise<RevenueEntity[]> => {
    try {
        console.log(`[API Service] Fetching revenue data for year: ${year}`);
        const response = await apiClient.get<RevenueEntity[]>('/revenue', {
            params: { year } 
        });
        console.log(`[API Service] Successfully fetched data for year: ${year}`, response.data);
        return response.data;
    } catch (error) {
        console.error(`[API Service] Error fetching revenue data for year ${year}:`, error);
        // Handle specific error types (e.g., network error, 4xx, 5xx)
        if (axios.isAxiosError(error)) {
            // Access specific Axios error properties if needed
            console.error('Axios error details:', error.response?.data);
        }
        throw error; // Re-throw the error to be handled by the caller
    }
};

// Response interface for sync operations
export interface SyncResponse {
    message: string;
    success?: boolean;  // Toegevoegd om match te maken met UI
    error?: string;     // Toegevoegd om match te maken met UI
    hoursSaved?: number;  // Toegevoegd voor uren synchronisatie
    totalHoursInDbForYear?: number;  // Toegevoegd voor uren synchronisatie
}

/**
 * Triggers a full synchronization of all data
 */
export const syncAllData = async (): Promise<SyncResponse> => {
    try {
        console.log('[API Service] Triggering full synchronization');
        const response = await apiClient.post<SyncResponse>('/sync');
        return response.data;
    } catch (error) {
        console.error('[API Service] Error during full sync:', error);
        throw error;
    }
};

/**
 * Synchronizes only projects and their lines
 */
export const syncProjectsOnly = async (): Promise<SyncResponse> => {
    try {
        console.log('[API Service] Triggering projects-only synchronization');
        const response = await apiClient.post<SyncResponse>('/sync/projects-only');
        return response.data;
    } catch (error) {
        console.error('[API Service] Error during projects-only sync:', error);
        throw error;
    }
};

/**
 * Synchronizes only offers and their lines
 */
export const syncOffersOnly = async (): Promise<SyncResponse> => {
    try {
        console.log('[API Service] Triggering offers-only synchronization');
        const response = await apiClient.post<SyncResponse>('/sync/offers-only');
        return response.data;
    } catch (error) {
        console.error('[API Service] Error during offers-only sync:', error);
        throw error;
    }
};

/**
 * Synchronizes hours for a specific year
 */
export const syncHoursForYear = async (year: number): Promise<SyncResponse> => {
    try {
        console.log(`[API Service] Triggering hours synchronization for year ${year}`);
        const response = await apiClient.post<SyncResponse>(`/sync/hours-only?year=${year}`);
        return response.data;
    } catch (error) {
        console.error(`[API Service] Error during hours sync for year ${year}:`, error);
        throw error;
    }
};

/**
 * Synchronizes hours from the last 3 months
 */
export const syncRecentHours = async (): Promise<SyncResponse> => {
    try {
        console.log('[API Service] Triggering recent hours synchronization');
        const response = await apiClient.post<SyncResponse>('/sync/recent-hours');
        return response.data;
    } catch (error) {
        console.error('[API Service] Error during recent hours sync:', error);
        throw error;
    }
};

// API functies voor KPI data
export const getKPIDataByYear = async (year: number): Promise<YearlyKPIs> => {
    try {
        console.log(`[API Service] Fetching KPI data for year: ${year}`);
        const response = await apiClient.get<YearlyKPIs>('/kpi', {
            params: { year } 
        });
        console.log(`[API Service] Successfully fetched KPI data for year: ${year}`, response.data);
        return response.data;
    } catch (error) {
        console.error(`[API Service] Error fetching KPI data for year ${year}:`, error);
        if (axios.isAxiosError(error)) {
            console.error('Axios error details:', error.response?.data);
        }
        throw error;
    }
};

/**
 * Update handmatige KPI waardes (targets en definitieve omzet)
 */
export const updateKPIValue = async (year: number, month: string, field: 'targetRevenue' | 'finalRevenue', value: number): Promise<{success: boolean, message: string}> => {
    try {
        console.log(`[API Service] Updating KPI ${field} for ${year}-${month} to ${value}`);
        const response = await apiClient.post('/kpi/update', {
            year,
            month,
            field,
            value
        });
        return response.data;
    } catch (error) {
        console.error(`[API Service] Error updating KPI value:`, error);
        throw error;
    }
};

// --- API functies voor handmatige data ---

// Interface voor de response van de consumption update
interface UpdateConsumptionResponse {
    success: boolean;
    message: string;
}

/**
 * Updates the manually entered previous year consumption for a project.
 * @param projectId The ID of the project.
 * @param targetYear The year the consumption applies TO (the year selected in the table).
 * @param consumptionAmount The amount consumed in the previous year (as a string).
 * @param viewMode 'revenue' or 'hours', indicating the unit of the amount.
 * @returns A promise resolving to the success status and message.
 */
export const updatePreviousYearConsumption = async (
    projectId: number,
    targetYear: number,
    consumptionAmount: string,
    viewMode: 'revenue' | 'hours'
): Promise<UpdateConsumptionResponse> => {
    try {
        console.log(`[API Service] Updating previous year consumption for project ${projectId}, target year ${targetYear}, amount ${consumptionAmount}, mode ${viewMode}`);
        const response = await apiClient.post<UpdateConsumptionResponse>('/manual/project-consumption', {
            projectId,
            targetYear,
            consumptionAmount,
            viewMode
        });
        console.log(`[API Service] Update consumption response:`, response.data);
        return response.data;
    } catch (error) {
        console.error(`[API Service] Error updating previous year consumption:`, error);
        // Verbeterde foutafhandeling
        let errorMessage = 'Fout bij bijwerken verbruik vorig jaar.';
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            errorMessage = error.response.data.message;
        }
        // Return een gestandaardiseerd error object
        return { success: false, message: errorMessage }; 
    }
};

// Add other API functions here later (e.g., for updating manual revenue) 