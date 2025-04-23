import { create } from 'zustand';
import { getRevenueDataByYear, getKPIDataByYear, RevenueEntity, YearlyKPIs } from '../services/api';

// Define cache interfaces
interface RevenueCache {
    [year: number]: {
        data: RevenueEntity[];
        timestamp: number;
    };
}

interface KPICache {
    [year: number]: {
        data: YearlyKPIs;
        timestamp: number;
    };
}

// Helper functions for localStorage
const REVENUE_CACHE_KEY = 'iris-revenue-cache';
const KPI_CACHE_KEY = 'iris-kpi-cache';

// Load cache from localStorage
const loadRevenueCache = (): RevenueCache => {
    try {
        const cachedData = localStorage.getItem(REVENUE_CACHE_KEY);
        return cachedData ? JSON.parse(cachedData) : {};
    } catch (error) {
        console.error('[Store] Error loading revenue cache from localStorage:', error);
        return {};
    }
};

const loadKPICache = (): KPICache => {
    try {
        const cachedData = localStorage.getItem(KPI_CACHE_KEY);
        return cachedData ? JSON.parse(cachedData) : {};
    } catch (error) {
        console.error('[Store] Error loading KPI cache from localStorage:', error);
        return {};
    }
};

// Save cache to localStorage
const saveRevenueCache = (cache: RevenueCache): void => {
    try {
        localStorage.setItem(REVENUE_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
        console.error('[Store] Error saving revenue cache to localStorage:', error);
    }
};

const saveKPICache = (cache: KPICache): void => {
    try {
        localStorage.setItem(KPI_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
        console.error('[Store] Error saving KPI cache to localStorage:', error);
    }
};

interface RevenueState {
    // Selected year
    selectedYear: number;

    // Current data state
    revenueData: RevenueEntity[];
    kpiData: YearlyKPIs | null;
    isLoading: boolean;
    error: string | null;

    // Cache
    revenueCache: RevenueCache;
    kpiCache: KPICache;
    cacheDuration: number; // Cache duration in milliseconds

    // Actions
    setSelectedYear: (year: number) => void;
    fetchRevenueData: (year: number, forceRefresh?: boolean) => Promise<RevenueEntity[]>;
    fetchKPIData: (year: number, forceRefresh?: boolean) => Promise<YearlyKPIs | null>;
    invalidateCache: (year?: number) => void;
    isCacheValid: (year: number, type: 'revenue' | 'kpi') => boolean;
}

const useRevenueStore = create<RevenueState>((set, get) => ({
    // Initial state
    selectedYear: 2025, // Set default year to 2025 instead of current year
    revenueData: [],
    kpiData: null,
    isLoading: false,
    error: null,

    // Cache initialization - load from localStorage
    revenueCache: loadRevenueCache(),
    kpiCache: loadKPICache(),
    cacheDuration: 30 * 60 * 1000, // 30 minutes cache duration

    // Check if cache is valid for a specific year and data type
    isCacheValid: (year: number, type: 'revenue' | 'kpi') => {
        const cache = type === 'revenue' ? get().revenueCache : get().kpiCache;
        const cachedData = cache[year];

        if (!cachedData) return false;

        const now = Date.now();
        const cacheAge = now - cachedData.timestamp;
        return cacheAge < get().cacheDuration;
    },

    // Set selected year
    setSelectedYear: (year) => {
        console.log(`[Store] Setting selected year to: ${year}`);
        set({ selectedYear: year });
    },

    // Fetch revenue data with caching
    fetchRevenueData: async (year, forceRefresh = false) => {
        console.log(`[Store] Attempting to fetch revenue data for year: ${year}, forceRefresh: ${forceRefresh}`);

        // Check cache first if not forcing refresh
        if (!forceRefresh && get().isCacheValid(year, 'revenue')) {
            console.log(`[Store] Using cached revenue data for year: ${year}`);
            const cachedData = get().revenueCache[year].data;
            set({ revenueData: cachedData, isLoading: false });
            return cachedData;
        }

        // Fetch from API if cache is invalid or forcing refresh
        if (get().isLoading) return get().revenueData; // Prevent simultaneous fetches

        set({ isLoading: true, error: null });
        try {
            const data = await getRevenueDataByYear(year);
            console.log(`[Store] Revenue data fetched successfully for year: ${year}, items: ${data.length}`);

            // Update cache
            const updatedCache = {
                ...get().revenueCache,
                [year]: {
                    data,
                    timestamp: Date.now()
                }
            };

            // Save to localStorage
            saveRevenueCache(updatedCache);

            set({
                revenueData: data,
                revenueCache: updatedCache,
                isLoading: false
            });

            return data;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
            console.error(`[Store] Error fetching revenue data for year ${year}:`, errorMessage);
            set({ isLoading: false, error: errorMessage });
            return [];
        }
    },

    // Fetch KPI data with caching
    fetchKPIData: async (year, forceRefresh = false) => {
        console.log(`[Store] Attempting to fetch KPI data for year: ${year}, forceRefresh: ${forceRefresh}`);

        // Check cache first if not forcing refresh
        if (!forceRefresh && get().isCacheValid(year, 'kpi')) {
            console.log(`[Store] Using cached KPI data for year: ${year}`);
            const cachedData = get().kpiCache[year].data;
            set({ kpiData: cachedData });
            return cachedData;
        }

        // Fetch from API if cache is invalid or forcing refresh
        try {
            const data = await getKPIDataByYear(year);
            console.log(`[Store] KPI data fetched successfully for year: ${year}`);

            // Update cache
            const updatedCache = {
                ...get().kpiCache,
                [year]: {
                    data,
                    timestamp: Date.now()
                }
            };

            // Save to localStorage
            saveKPICache(updatedCache);

            set({
                kpiData: data,
                kpiCache: updatedCache
            });

            return data;
        } catch (err) {
            console.error(`[Store] Error fetching KPI data for year ${year}:`, err);
            set({ kpiData: null });
            return null;
        }
    },

    // Invalidate cache for a specific year or all years
    invalidateCache: (year) => {
        console.log(`[Store] Invalidating cache${year ? ` for year: ${year}` : ' for all years'}`);

        if (year) {
            // Invalidate cache for specific year
            const newRevenueCache = { ...get().revenueCache };
            const newKPICache = { ...get().kpiCache };

            delete newRevenueCache[year];
            delete newKPICache[year];

            // Update localStorage
            saveRevenueCache(newRevenueCache);
            saveKPICache(newKPICache);

            set({
                revenueCache: newRevenueCache,
                kpiCache: newKPICache
            });
        } else {
            // Invalidate all cache
            // Clear localStorage
            saveRevenueCache({});
            saveKPICache({});

            set({
                revenueCache: {},
                kpiCache: {}
            });
        }
    }
}));

export default useRevenueStore;