import { create } from 'zustand';
import { getRevenueDataByYear, RevenueEntity } from '../services/api'; // Import API function and type

interface RevenueState {
    selectedYear: number;
    revenueData: RevenueEntity[];
    isLoading: boolean;
    error: string | null;
    setSelectedYear: (year: number) => void;
    fetchRevenueData: (year: number) => Promise<void>;
}

const useRevenueStore = create<RevenueState>((set, get) => ({
    selectedYear: new Date().getFullYear(), // Dynamisch het huidige jaar gebruiken
    revenueData: [],
    isLoading: false,
    error: null,

    setSelectedYear: (year) => {
        console.log(`[Store] Setting selected year to: ${year}`);
        set({ selectedYear: year });
        // Optionally fetch data immediately when year changes
        // get().fetchRevenueData(year);
    },

    fetchRevenueData: async (year) => {
        console.log(`[Store] Attempting to fetch data for year: ${year}`);
        if (get().isLoading) return; // Prevent simultaneous fetches
        set({ isLoading: true, error: null });
        try {
            const data = await getRevenueDataByYear(year);
            console.log(`[Store] Data fetched successfully for year: ${year}`);
            set({ revenueData: data, isLoading: false });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
            console.error(`[Store] Error fetching data for year ${year}:`, errorMessage);
            set({ isLoading: false, error: errorMessage, revenueData: [] }); // Clear data on error
        }
    },
}));

export default useRevenueStore; 